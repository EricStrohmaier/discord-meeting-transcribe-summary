import path from 'path';
import fs from 'fs';
import AsyncLock from 'async-lock';
import {
  ChatInputCommandInteraction,
  MessageFlags,
  ChannelType,
  ThreadChannel,
  NewsChannel,
  TextChannel,
} from 'discord.js';
import config from 'config';
import * as utils from '../../utils/utils';
import * as embeds from '../../utils/embeds';
import state from '../../utils/state';
import { BotConfig } from '../../types';

const stateLock = new AsyncLock();

const MEETINGS_DIR = path.join(__dirname, '../../../meetings/');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const botConfig = config as unknown as BotConfig;

  await stateLock.acquire('recording', async () => {
    if (!state.recordingProcess || !state.connection) {
      await interaction.reply({
        content: ':x: No active recording',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      console.log('Stopping connection and cleaning up resources...');

      await interaction.reply({ embeds: [embeds.processingAudioEmbed] });
      await utils.cleanupRecording();

      const meetingName = state.currentMeeting!;
      state.currentMeeting = null;

      const meetingPath = path.join(MEETINGS_DIR, meetingName);

      const oggPath = path.join(meetingPath, `${meetingName}.ogg`);
      const mp3Path = path.join(meetingPath, `${meetingName}.mp3`);

      console.log(`Checking if OGG file exists at: ${oggPath}`);
      if (!fs.existsSync(oggPath)) {
        console.error('OGG file not found!');
        await interaction.editReply({ embeds: [embeds.errorWhileRecordingEmbed] });
        return;
      }

      state.meetings.push({
        name: meetingName,
        recorded: true,
        transcribed: false,
        summarized: false,
      });

      await interaction.editReply({ embeds: [embeds.recordingStoppedEmbed] });
      let thread: ThreadChannel | TextChannel | NewsChannel;
      const channel = interaction.channel;

      if (channel?.isThread()) {
        thread = channel;
      } else if (
        channel?.type === ChannelType.GuildText ||
        channel?.type === ChannelType.GuildAnnouncement
      ) {
        const message = await interaction.fetchReply();
        try {
          thread = await message.startThread({
            name: `Summary of the meeting '${meetingName}'`,
          });
        } catch (err) {
          console.warn(
            'Could not start thread from message, falling back to current channel:',
            (err as Error)?.message || err
          );
          thread = channel;
        }
      } else {
        // Fallback - treat as text channel
        thread = channel as unknown as TextChannel;
      }

      console.log('Converting OGG to MP3...');
      try {
        await utils.convertOggToMp3(oggPath, mp3Path);
      } catch (err) {
        console.error('Error converting OGG to MP3: ', err);
        throw new Error('Conversion failed');
      }

      console.log('Starting audio splitting...');
      let audioParts: string[];
      try {
        audioParts = await utils.splitAudioFile(
          mp3Path,
          botConfig.openai.transcription_max_size_MB
        );
        console.log(`Audio splitting successful. Parts: ${audioParts.length}`);
      } catch (err) {
        console.error('Error while splitting the file: ', err);
        throw new Error('Splitting failed');
      }

      console.log('Starting transcription...');
      let transcription: string;
      let transcriptionFile: string;
      try {
        transcription = await utils.transcribe(audioParts);
        if (!transcription) {
          console.error('Transcription failed!');
          throw new Error('Transcription failed');
        }

        console.log('Saving transcription to file...');
        transcriptionFile = path.join(meetingPath, `${meetingName}.txt`);
        fs.writeFileSync(transcriptionFile, transcription, {
          encoding: 'utf8',
        });
      } catch (err) {
        console.error('Error during transcription: ', err);
        throw new Error('Transcription failed');
      }

      console.log('Starting summary generation...');
      let summary: string;
      try {
        summary = await utils.summarize(transcriptionFile);
        if (!summary) {
          console.error('Summary generation failed!');
          throw new Error('Summary failed');
        }

        console.log('Saving summary to file...');
        const summaryFile = path.join(meetingPath, `${meetingName}.md`);
        fs.writeFileSync(summaryFile, summary, { encoding: 'utf8' });
      } catch (err) {
        console.error('Error during summary generation: ', err);
        throw new Error('Summary failed');
      }

      console.log('Sending summary to channel/thread...');
      try {
        await utils.sendSummary(summary, thread);
        await interaction.editReply({ embeds: [embeds.processingSuccessEmbed] });
      } catch (sendErr) {
        console.warn(
          'Primary summary send failed, trying interaction followUp fallback:',
          (sendErr as Error)?.message || sendErr
        );
        const lines = summary.split('\n');
        let chunk = '';
        for (const line of lines) {
          if ((chunk + '\n' + line).length > 2000) {
            await interaction.followUp(chunk);
            chunk = line;
          } else {
            chunk += (chunk ? '\n' : '') + line;
          }
        }
        if (chunk) await interaction.followUp(chunk);
        await interaction.editReply({ embeds: [embeds.processingSuccessEmbed] });
      }
    } catch (error) {
      console.error('Stop command error:', error);
      await interaction.editReply({
        embeds: [embeds.processingFailedEmbed((error as Error).message)],
      });
    } finally {
      console.log('Cleaning up state...');
      state.connection = null;
      state.recordingProcess = null;
      state.userBuffers = null;
      state.userStreams = null;
      state.currentMeeting = null;
    }
  });
}
