import fs from 'fs';
import path from 'path';
import { ChatInputCommandInteraction, AutocompleteInteraction } from 'discord.js';
import state from '../../utils/state';
import * as embeds from '../../utils/embeds';

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

  if (what === 'recording') {
    const files = fs.readdirSync(meetingPath);
    const audioFiles = files.filter((file) => file.endsWith('.ogg') || file.endsWith('.mp3'));

    if (audioFiles.length === 0) {
      await interaction.editReply({
        embeds: [embeds.noRecordingsExistEmbed],
      });
      return;
    }

    audioFiles.forEach((file) => fs.unlinkSync(path.join(meetingPath, file)));

    const meeting = state.meetings.find((meeting) => meeting.name === meetingName);
    if (meeting) meeting.recorded = false;

    await interaction.editReply({ embeds: [embeds.fileDeletedEmbed] });
  } else {
    fs.rmSync(meetingPath, { recursive: true, force: true });
    state.meetings = state.meetings.filter((meeting) => meeting.name !== meetingName);
    await interaction.editReply({ embeds: [embeds.meetingDeletedEmbed] });
  }
}
