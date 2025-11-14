import fs from 'fs';
import path from 'path';
import {
  ChatInputCommandInteraction,
  MessageFlags,
  GuildMember,
  AutocompleteInteraction,
} from 'discord.js';
import config from 'config';
import state from '../../utils/state';
import * as embeds from '../../utils/embeds';
import { BotConfig } from '../../types';

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focusedValue = interaction.options.getFocused().toLowerCase();
  const choices = state.meetings.map((meeting) => meeting.name);
  const filtered = choices
    .filter((choice) => choice.toLowerCase().startsWith(focusedValue))
    .slice(0, 25);

  await interaction.respond(filtered.map((choice) => ({ name: choice, value: choice })));
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.member as GuildMember;
  const memberRoles = member.roles.cache.map((role) => role.name);
  const botConfig = config as unknown as BotConfig;
  const hasPermission = memberRoles.some((role) => botConfig.allowed_roles.includes(role));

  if (!hasPermission) {
    await interaction.reply({
      embeds: [embeds.noPermissionEmbed],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();

  const meetingName = interaction.options.getString('name', true);
  const what = interaction.options.getString('what', true);
  const MEETINGS_DIR = path.join(__dirname, '../../../meetings/');
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
