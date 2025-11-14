const path = require('path');
const fs = require('fs');
const AsyncLock = require('async-lock');
const { MessageFlags, ChannelType } = require('discord.js');
const config = require('config');
const utils = require('../../utils/utils');
const embeds = require('../../utils/embeds');
const state = require('../../utils/state');

const stateLock = new AsyncLock();

const MEETINGS_DIR = path.join(__dirname, '../../../meetings/');

module.exports = {
  async execute(interaction) {
    const memberRoles = interaction.member.roles.cache.map((role) => role.name);
    const hasPermission = memberRoles.some((role) =>
      config.get('allowed_roles').includes(role)
    );

    if(!hasPermission)
      return await interaction.reply({
        embeds: [embeds.noPermissionEmbed],
        flags: MessageFlags.Ephemeral,
      });

    await stateLock.acquire('recording', async () => {
      if(!state.recordingProcess || !state.connection)
        return await interaction.reply({
          embeds: [embeds.noActiveRecordingEmbed],
          flags: MessageFlags.Ephemeral,
        });

      try {
        console.log('Stopping connection and cleaning up resources...');

        await interaction.reply({ embeds: [embeds.processingAudioEmbed] });
        await utils.cleanupRecording();

        const meetingName = state.currentMeeting;
        state.currentMeeting = null;

        const meetingPath = path.join(MEETINGS_DIR, meetingName);

        const oggPath = path.join(meetingPath, `${meetingName}.ogg`);
        const mp3Path = path.join(meetingPath, `${meetingName}.mp3`);

        console.log(`Checking if OGG file exists at: ${oggPath}`);
        if(!fs.existsSync(oggPath)) {
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
        let thread;
        const channel = interaction.channel;
        if(channel.isThread()) {
          thread = channel;
        } else if(
          channel.type === ChannelType.GuildText ||
          channel.type === ChannelType.GuildAnnouncement
        ) {
          const message = await interaction.fetchReply();
          try {
            thread = await message.startThread({
              name: `Summary of the meeting '${meetingName}'`,
            });
          } catch(err) {
            console.warn('Could not start thread from message, falling back to current channel:', err?.message || err);
            thread = channel;
          }
        } else {
          // Cannot start a thread here; fall back to posting in the current channel
          thread = channel;
        }

        console.log('Converting OGG to MP3...');
        try {
          await utils.convertOggToMp3(oggPath, mp3Path);
        } catch(err) {
          console.error('Error converting OGG to MP3: ', err);
          throw new Error('Conversion failed');
        }

        console.log('Starting audio splitting...');
        let audioParts;
        try {
          audioParts = await utils.splitAudioFile(mp3Path, config.get('openai.transcription_max_size_MB'));
          console.log(`Audio splitting successful. Parts: ${audioParts.length}`);
        } catch(err) {
          console.error('Error while splitting the file: ', err);
          throw new Error('Splitting failed');
        }

        console.log('Starting transcription...');
        let transcription, transcriptionFile;
        try {
          transcription = await utils.transcribe(audioParts);
          if(!transcription) {
            console.error('Transcription failed!');
            throw new Error('Transcription failed');
          }

          console.log('Saving transcription to file...');
          transcriptionFile = path.join(meetingPath, `${meetingName}.txt`);
          fs.writeFileSync(transcriptionFile, transcription, {
            encoding: 'utf8',
          });
        } catch(err) {
          console.error('Error during transcription: ', err);
          throw new Error('Transcription failed');
        }

        console.log('Starting summary generation...');
        let summary;
        try {
          summary = await utils.summarize(transcriptionFile);
          if(!summary) {
            console.error('Summary generation failed!');
            throw new Error('Summary failed');
          }

          console.log('Saving summary to file...');
          const summaryFile = path.join(meetingPath, `${meetingName}.md`);
          fs.writeFileSync(summaryFile, summary, { encoding: 'utf8' });
        } catch(err) {
          console.error('Error during summary generation: ', err);
          throw new Error('Summary failed');
        }

        console.log('Sending summary to channel/thread...');
        try {
          await utils.sendSummary(summary, thread);
          await interaction.editReply({ embeds: [embeds.processingSuccessEmbed] });
        } catch(sendErr) {
          console.warn('Primary summary send failed, trying interaction followUp fallback:', sendErr?.message || sendErr);
          // Fallback: send in chunks via interaction.followUp
          const lines = summary.split('\n');
          let chunk = '';
          for(const line of lines) {
            if((chunk + '\n' + line).length > 2000) {
              await interaction.followUp(chunk);
              chunk = line;
            } else {
              chunk += (chunk ? '\n' : '') + line;
            }
          }
          if(chunk) await interaction.followUp(chunk);
          await interaction.editReply({ embeds: [embeds.processingSuccessEmbed] });
        }
      } catch(error) {
        console.error('Stop command error:', error);
        await interaction.editReply({ embeds: [embeds.processingFailedEmbed(error.message)] });
      } finally {
        console.log('Cleaning up state...');
        state.connection = null;
        state.recordingProcess = null;
        state.userBuffers = null;
        state.userStreams = null;
        state.currentMeeting = null;
      }
    });
  },
};