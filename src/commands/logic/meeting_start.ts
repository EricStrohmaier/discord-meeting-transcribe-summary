import { joinVoiceChannel, VoiceConnectionStatus, EndBehaviorType } from '@discordjs/voice';
import { ChatInputCommandInteraction, MessageFlags, GuildMember } from 'discord.js';
import fs from 'fs';
import path from 'path';
import prism from 'prism-media';
import { spawn } from 'child_process';
import { PassThrough } from 'stream';
import AsyncLock from 'async-lock';

import { cleanupRecording, resolveFfmpegPath } from '../../utils/utils';
import * as embeds from '../../utils/embeds';
import state from '../../utils/state';
import { AudioSettings, UserBuffer } from '../../types';

const stateLock = new AsyncLock();

const MEETINGS_DIR = path.join(__dirname, '../../../meetings/');
const AUDIO_SETTINGS: AudioSettings = {
  channels: 1,
  rate: 48000,
  frameSize: 960,
  bitrate: '64k',
  mixInterval: 20,
};

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.member as GuildMember;

  if (interaction.channel?.isThread()) {
    await interaction.reply({
      embeds: [embeds.threadEmbed],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await stateLock.acquire('recording', async () => {
    if (state.currentMeeting) {
      await interaction.reply({
        embeds: [embeds.recordingAlreadyStartedEmbed],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const meetingName = interaction.options.getString('name', true);

    if (state.meetings.map((m) => m.name).includes(meetingName)) {
      await interaction.reply({
        embeds: [embeds.meetingAlreadyExistsEmbed],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const voiceChannel = member.voice.channel;
    if (!voiceChannel) {
      await interaction.reply({
        embeds: [embeds.noVoiceChannelEmbed],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      state.connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guild!.id,
        adapterCreator: interaction.guild!.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: true,
      });

      if (!state.connection) {
        await interaction.reply({
          embeds: [embeds.errorWhileRecordingEmbed],
        });
        return;
      }

      state.connection.on('stateChange', (oldState, newState) => {
        if (
          newState.status === VoiceConnectionStatus.Disconnected &&
          oldState.status !== newState.status
        ) {
          console.error('Unexpected disconnection!');
          cleanupRecording();
        }
      });

      state.currentMeeting = meetingName;
      await interaction.reply({ embeds: [embeds.recordingStartedEmbed(meetingName)] });

      if (!fs.existsSync(MEETINGS_DIR)) fs.mkdirSync(MEETINGS_DIR, { recursive: true });

      const meetingFolder = path.join(MEETINGS_DIR, state.currentMeeting);
      if (!fs.existsSync(meetingFolder)) fs.mkdirSync(meetingFolder, { recursive: true });

      const ffmpegPath = resolveFfmpegPath();

      const oggPath = path.join(meetingFolder, `${state.currentMeeting}.ogg`);
      state.recordingProcess = spawn(
        ffmpegPath,
        [
          '-f',
          's16le',
          '-ar',
          AUDIO_SETTINGS.rate.toString(),
          '-ac',
          AUDIO_SETTINGS.channels.toString(),
          '-i',
          'pipe:0',
          '-c:a',
          'libopus',
          '-b:a',
          AUDIO_SETTINGS.bitrate,
          '-application',
          'voip',
          '-flush_packets',
          '1',
          '-vn',
          '-y',
          oggPath,
        ],
        {
          stdio: ['pipe', 'ignore', 'ignore'],
        }
      );

      state.recordingProcess.on('error', (err) => {
        console.error('Recording process error: ', err);
        interaction.editReply({ embeds: [embeds.errorWhileRecordingEmbed] });
        if (state.connection) {
          state.connection.destroy();
          state.connection = null;
        }
      });

      state.recordingProcess.on('close', async () => {
        if (!fs.existsSync(oggPath)) {
          console.error('OGG file does not exist');
          await interaction.editReply({ embeds: [embeds.errorWhileRecordingEmbed] });
        } else {
          console.log('Recording saved successfully');
        }
      });

      state.userBuffers = new Map<string, UserBuffer>();
      state.mixingInterval = setInterval(() => {
        const chunkSize = AUDIO_SETTINGS.rate * 2 * (AUDIO_SETTINGS.mixInterval / 1000);

        const users = Array.from(state.userBuffers!.entries());
        if (users.length === 0) return;

        const userChunks: Buffer[] = [];
        for (const [, user] of users) {
          const available = user.buffer.length - user.position;
          const bytesToRead = Math.min(available, chunkSize);
          let chunk: Buffer;

          if (bytesToRead > 0) {
            chunk = user.buffer.subarray(user.position, user.position + bytesToRead);
            user.position += bytesToRead;
            if (user.position >= user.buffer.length) {
              user.buffer = Buffer.alloc(0);
              user.position = 0;
            }
          } else {
            chunk = Buffer.alloc(0);
          }

          if (chunk.length < chunkSize) {
            const padding = Buffer.alloc(chunkSize - chunk.length);
            chunk = Buffer.concat([chunk, padding]);
          }

          userChunks.push(chunk);
        }

        const mixedBuffer = Buffer.alloc(chunkSize);
        const mixedSamples = new Int16Array(
          mixedBuffer.buffer,
          mixedBuffer.byteOffset,
          chunkSize / 2
        );
        mixedSamples.fill(0);

        for (const chunk of userChunks) {
          const userSamples = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.length / 2);
          for (let i = 0; i < userSamples.length; i++) {
            const sum = mixedSamples[i] + userSamples[i];
            mixedSamples[i] = Math.max(-32768, Math.min(32767, sum));
          }
        }

        if (state.recordingProcess?.stdin && !state.recordingProcess.stdin.destroyed) {
          state.recordingProcess.stdin.write(mixedBuffer);
        }
      }, AUDIO_SETTINGS.mixInterval);

      const receiver = state.connection.receiver;
      state.userStreams = new Map();

      let opusDecoderAvailable = true;
      try {
        const decoder = new prism.opus.Decoder({
          rate: AUDIO_SETTINGS.rate,
          channels: AUDIO_SETTINGS.channels,
          frameSize: AUDIO_SETTINGS.frameSize,
        });
        decoder.destroy();
      } catch (e) {
        opusDecoderAvailable = false;
        console.error(
          'Opus decoder not available. Install @discordjs/opus or opusscript to record audio.',
          e
        );
      }

      if (!opusDecoderAvailable) {
        await interaction.editReply({ embeds: [embeds.errorWhileRecordingEmbed] });
        await cleanupRecording();
        state.currentMeeting = null;
        return;
      }

      receiver.speaking.on('start', (userId) => {
        if (!state.userStreams || !state.userBuffers) return;
        if (state.userStreams.has(userId)) return;

        console.log(`[audio] User ${userId} started speaking`);

        let opusDecoder: prism.opus.Decoder;
        try {
          opusDecoder = new prism.opus.Decoder({
            rate: AUDIO_SETTINGS.rate,
            channels: AUDIO_SETTINGS.channels,
            frameSize: AUDIO_SETTINGS.frameSize,
          });
        } catch (e) {
          console.error(
            'Failed to initialize Opus decoder. Install @discordjs/opus or opusscript to record audio.',
            e
          );
          return;
        }

        const audioStream = receiver.subscribe(userId, {
          end: {
            behavior: EndBehaviorType.AfterSilence,
            duration: 200,
          },
        });

        const pcmStream = new PassThrough();

        audioStream.pipe(opusDecoder).pipe(pcmStream);

        if (!state.userBuffers.has(userId)) {
          state.userBuffers.set(userId, { buffer: Buffer.alloc(0), position: 0 });
        }

        pcmStream.on('data', (chunk: Buffer) => {
          const user = state.userBuffers!.get(userId);
          if (user) {
            user.buffer = Buffer.concat([user.buffer, chunk]);
          }
        });

        state.userStreams.set(userId, {
          audioStream,
          opusDecoder,
          pcmStream,
        });
      });

      receiver.speaking.on('end', (userId) => {
        if (!state.userStreams || !state.userBuffers) return;
        const streamInfo = state.userStreams.get(userId);
        if (streamInfo) {
          const userBuf = state.userBuffers.get(userId);
          console.log(
            `[audio] User ${userId} stopped speaking. Buffer: ${userBuf ? userBuf.buffer.length : 0} bytes`
          );
          streamInfo.audioStream.destroy();
          streamInfo.opusDecoder.destroy();
          streamInfo.pcmStream.destroy();
          state.userStreams.delete(userId);
        }
      });
    } catch (error) {
      console.error('Meeting start error:', error);

      if (state.connection) {
        state.connection.destroy();
        state.connection = null;
      }

      if (state.mixingInterval) {
        clearInterval(state.mixingInterval);
        state.mixingInterval = null;
      }

      if (state.recordingProcess) {
        state.recordingProcess.kill('SIGKILL');
        state.recordingProcess = null;
      }

      state.currentMeeting = null;
      state.userBuffers = null;
      state.userStreams = null;
      await interaction.editReply({ embeds: [embeds.errorWhileRecordingEmbed] });
    }
  });
}
