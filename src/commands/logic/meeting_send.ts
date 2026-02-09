import fs from 'fs';
import path from 'path';
import { ChatInputCommandInteraction, AutocompleteInteraction, TextChannel } from 'discord.js';
import state from '../../utils/state';
import * as embeds from '../../utils/embeds';
import * as utils from '../../utils/utils';

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focusedValue = interaction.options.getFocused().toLowerCase();
  const choices = ['latest', ...state.meetings.map((meeting) => meeting.name)];
  const filtered = choices
    .filter((choice) => choice.toLowerCase().startsWith(focusedValue))
    .slice(0, 25);

  await interaction.respond(filtered.map((choice) => ({ name: choice, value: choice })));
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  let meetingName = interaction.options.getString('name', true);
  const what = interaction.options.getString('what', true);
  const MEETINGS_DIR = path.join(__dirname, '../../../meetings/');

  if (meetingName === 'latest') {
    if (!fs.existsSync(MEETINGS_DIR)) {
      await interaction.editReply({ embeds: [embeds.meetingDoesNotExistEmbed] });
      return;
    }

    const entries = fs
      .readdirSync(MEETINGS_DIR)
      .map((name) => ({ name, fullPath: path.join(MEETINGS_DIR, name) }))
      .filter((entry) => fs.existsSync(entry.fullPath) && fs.statSync(entry.fullPath).isDirectory())
      .map((entry) => ({
        name: entry.name,
        fullPath: entry.fullPath,
        mtimeMs: fs.statSync(entry.fullPath).mtimeMs,
      }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    if (entries.length === 0) {
      await interaction.editReply({ embeds: [embeds.meetingDoesNotExistEmbed] });
      return;
    }

    meetingName = entries[0].name;
  }

  const meetingPath = path.join(MEETINGS_DIR, meetingName);

  if (!fs.existsSync(meetingPath)) {
    await interaction.editReply({
      embeds: [embeds.meetingDoesNotExistEmbed],
    });
    return;
  }

  let fileToSend: string | undefined;
  const files = fs.readdirSync(meetingPath);
  if (what === 'recording') {
    const audioFiles = files.filter((file) => file.endsWith('.mp3') || file.endsWith('.ogg'));

    if (audioFiles.length === 0) {
      await interaction.editReply({
        embeds: [embeds.noRecordingsExistEmbed],
      });
      return;
    }

    fileToSend = path.join(meetingPath, audioFiles[0]);
  } else if (what === 'summary') {
    const mdFiles = files.filter((file) => file.endsWith('.md'));
    if (mdFiles.length === 0) {
      await interaction.editReply({
        embeds: [embeds.noSummaryExistEmbed],
      });
      return;
    }

    fileToSend = path.join(meetingPath, mdFiles[0]);
  } else if (what === 'transcription') {
    const txtFiles = files.filter((file) => file.endsWith('.txt'));
    if (txtFiles.length === 0) {
      await interaction.editReply({
        embeds: [embeds.noTranscriptionExistEmbed],
      });
      return;
    }

    fileToSend = path.join(meetingPath, txtFiles[0]);
  }

  if (!fileToSend) {
    await interaction.editReply({
      content: ':x: Invalid option',
    });
    return;
  }

  if (fileToSend.endsWith('.md')) {
    const fileContent = fs.readFileSync(fileToSend, 'utf-8');
    await interaction.editReply(':arrow_down: Summary');

    if (interaction.channel?.isThread()) {
      await utils.sendSummary(fileContent, interaction.channel);
    } else {
      const message = await interaction.fetchReply();
      try {
        const thread = await message.startThread({
          name: `Summary of the meeting '${meetingName}'`,
        });
        await utils.sendSummary(fileContent, thread);
      } catch (err) {
        console.warn(
          'Could not start thread for summary, falling back to channel:',
          (err as Error)?.message || err
        );
        await utils.sendSummary(fileContent, interaction.channel! as unknown as TextChannel);
      }
    }
  } else {
    await interaction.editReply({
      files: [fileToSend],
    });
  }
}
