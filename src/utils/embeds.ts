import { EmbedBuilder } from 'discord.js';

export const recordingStartedEmbed = (meetingName: string) =>
  new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(':red_circle: Recording Started')
    .setDescription(`The meeting recording for '${meetingName}' has started successfully.`)
    .setTimestamp();

export const recordingStoppedEmbed = new EmbedBuilder()
  .setColor(0x3498db)
  .setTitle(':octagonal_sign: Recording Stopped')
  .setDescription('The meeting recording has been stopped.')
  .setTimestamp();

export const transcriptionStartedEmbed = new EmbedBuilder()
  .setColor(0x3498db)
  .setTitle(':scroll: Transcription Started')
  .setDescription('The meeting transcription has started successfully.')
  .setTimestamp();

export const transcriptionCompletedEmbed = new EmbedBuilder()
  .setColor(0x00ff00)
  .setTitle(':white_check_mark: Transcription Completed')
  .setDescription('The transcription has been successfully generated.')
  .setTimestamp();

export const transcriptionFailedEmbed = new EmbedBuilder()
  .setColor(0xff0000)
  .setTitle(':x: Transcription Failed')
  .setDescription('An error occurred while generating the transcription.')
  .setTimestamp();

export const summaryStartedEmbed = new EmbedBuilder()
  .setColor(0x3498db)
  .setTitle(':page_facing_up: Summary Started')
  .setDescription('The meeting summary is being generated.')
  .setTimestamp();

export const summaryCompletedEmbed = new EmbedBuilder()
  .setColor(0x00ff00)
  .setTitle(':white_check_mark: Summary Completed')
  .setDescription('The meeting summary has been successfully generated.')
  .setTimestamp();

export const summaryFailedEmbed = new EmbedBuilder()
  .setColor(0xff0000)
  .setTitle(':x: Summary Failed')
  .setDescription('An error occurred while generating the summary.')
  .setTimestamp();

export const meetingDeletedEmbed = new EmbedBuilder()
  .setColor(0x00ff00)
  .setTitle(':wastebasket: Meeting Deleted')
  .setDescription('The meeting has been successfully deleted.')
  .setTimestamp();

export const fileDeletedEmbed = new EmbedBuilder()
  .setColor(0x00ff00)
  .setTitle(':floppy_disk: Recording Deleted')
  .setDescription('A recording file has been successfully deleted.')
  .setTimestamp();

export const noPermissionEmbed = new EmbedBuilder()
  .setColor(0xff0000)
  .setTitle(':no_entry_sign: You do not have permission to use this command')
  .setDescription('You lack the necessary permissions to execute this command.')
  .setTimestamp();

export const recordingAlreadyStartedEmbed = new EmbedBuilder()
  .setColor(0xffcc00)
  .setTitle(':warning: A meeting is already being recorded')
  .setDescription('Please stop the current recording before starting a new one.')
  .setTimestamp();

export const meetingAlreadyExistsEmbed = new EmbedBuilder()
  .setColor(0xffcc00)
  .setTitle(':warning: A meeting with this name already exists')
  .setDescription('Please choose a different name for the new meeting.')
  .setTimestamp();

export const noVoiceChannelEmbed = new EmbedBuilder()
  .setColor(0xff0000)
  .setTitle(':warning: You have to be in a voice chat')
  .setDescription('Please join a voice channel before using this command.')
  .setTimestamp();

export const errorWhileRecordingEmbed = new EmbedBuilder()
  .setColor(0xff0000)
  .setTitle(':x: Error while recording')
  .setDescription('An error occurred while the recording.')
  .setTimestamp();

export const splittingStartedEmbed = new EmbedBuilder()
  .setColor(0x3498db)
  .setTitle(':arrows_counterclockwise: Splitting Audio File')
  .setDescription('Splitting the file into chunks of the configured max size.')
  .setTimestamp();

export const splittingSuccessEmbed = (numParts: number) =>
  new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle(':white_check_mark: Splitting Complete')
    .setDescription(
      numParts === 1
        ? 'No splitting was needed. The file is within the allowed size limit.'
        : `The file has been split into ${numParts} parts successfully.`
    )
    .setTimestamp();

export const splittingFailedEmbed = new EmbedBuilder()
  .setColor(0xff0000)
  .setTitle(':x: Failed to Split File')
  .setDescription('An error occurred while splitting the audio file.')
  .setTimestamp();

export const processingSuccessEmbed = new EmbedBuilder()
  .setColor(0x00ff00)
  .setTitle(':white_check_mark: Meeting Processed Successfully')
  .setDescription('The recording was transcribed and summarized successfully.')
  .addFields(
    {
      name: ':scroll: Transcription',
      value: ':white_check_mark: Completed',
      inline: true,
    },
    {
      name: ':page_facing_up: Summary',
      value: ':white_check_mark: Generated',
      inline: true,
    }
  )
  .setTimestamp();

export const meetingDoesNotExistEmbed = new EmbedBuilder()
  .setColor(0xff0000)
  .setTitle(':x: Meeting Does Not Exist')
  .setDescription('The meeting you are trying to access does not exist.')
  .setTimestamp();

export const noRecordingsExistEmbed = new EmbedBuilder()
  .setColor(0xff0000)
  .setTitle(':x: No Recordings Found')
  .setDescription('There are no recordings associated with this meeting.')
  .setTimestamp();

export const processingFailedEmbed = (error: unknown) =>
  new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle(':x: Processing Failed')
    .setDescription('An error occurred while processing the meeting.')
    .addFields({ name: 'Error:', value: String(error) })
    .setTimestamp();

export const convertingStartedEmbed = new EmbedBuilder()
  .setColor(0x3498db)
  .setTitle(':arrows_counterclockwise: Converting OGG to MP3')
  .setDescription('Converting the OGG file to MP3 format.')
  .setTimestamp();

export const convertingSuccessEmbed = new EmbedBuilder()
  .setColor(0x00ff00)
  .setTitle(':white_check_mark: Conversion Complete')
  .setDescription('The OGG file has been successfully converted to MP3 format.')
  .setTimestamp();

export const convertingFailedEmbed = new EmbedBuilder()
  .setColor(0xff0000)
  .setTitle(':x: Conversion Failed')
  .setDescription('An error occurred while converting the OGG file to MP3 format.')
  .setTimestamp();

export const threadEmbed = new EmbedBuilder()
  .setColor(0xff0000)
  .setTitle(':x: Command Not Allowed')
  .setDescription('This command cannot be used in a thread.')
  .setTimestamp();

export const processingAudioEmbed = new EmbedBuilder()
  .setColor(0x3498db)
  .setTitle(':arrows_counterclockwise: Processing Audio')
  .setDescription('The audio is being processed.')
  .setTimestamp();

export const noTranscriptionExistEmbed = new EmbedBuilder()
  .setColor(0xff0000)
  .setTitle(':x: No Transcription Found')
  .setDescription('There is no transcription associated with this meeting.')
  .setTimestamp();

export const noSummaryExistEmbed = new EmbedBuilder()
  .setColor(0xff0000)
  .setTitle(':x: No Summary Found')
  .setDescription('There is no summary associated with this meeting.')
  .setTimestamp();
