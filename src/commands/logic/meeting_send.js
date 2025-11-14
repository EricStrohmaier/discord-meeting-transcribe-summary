const fs = require('fs');
const path = require('path');
const { MessageFlags } = require('discord.js');
const state = require('../../utils/state');
const embeds = require('../../utils/embeds');
const config = require('config');
const utils = require('../../utils/utils');

module.exports = {
  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused().toLowerCase();
    const choices = state.meetings.map((meeting) => meeting.name);
    const filtered = choices
      .filter((choice) => choice.toLowerCase().startsWith(focusedValue))
      .slice(0, 25);

    await interaction.respond(
      filtered.map((choice) => ({ name: choice, value: choice }))
    );
  },

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

    await interaction.deferReply();

    const meetingName = interaction.options.getString('name');
    const what = interaction.options.getString('what');
    const MEETINGS_DIR = path.join(__dirname, '../../../meetings/');
    const meetingPath = path.join(MEETINGS_DIR, meetingName);

    if(!fs.existsSync(meetingPath))
      return await interaction.editReply({
        embeds: [embeds.meetingDoesNotExistEmbed],
        flags: MessageFlags.Ephemeral,
      });

    let fileToSend;
    const files = fs.readdirSync(meetingPath);
    if(what === 'recording') {
      const audioFiles = files.filter(
        (file) => file.endsWith('.mp3') || file.endsWith('.ogg')
      );

      if(audioFiles.length === 0)
        return await interaction.editReply({
          embeds: [embeds.noRecordingsExistEmbed],
          flags: MessageFlags.Ephemeral,
        });

      fileToSend = path.join(meetingPath, audioFiles[0]);
    } else if(what === 'summary') {
      const mdFiles = files.filter((file) => file.endsWith('.md'));
      if(mdFiles.length === 0)
        return await interaction.editReply({
          embeds: [embeds.noSummaryExistEmbed],
          flags: MessageFlags.Ephemeral,
        });

      fileToSend = path.join(meetingPath, mdFiles[0]);
    } else if(what === 'transcription') {
      const txtFiles = files.filter((file) => file.endsWith('.txt'));
      if(txtFiles.length === 0)
        return await interaction.editReply({
          embeds: [embeds.noTranscriptionExistEmbed],
          flags: MessageFlags.Ephemeral,
        });

      fileToSend = path.join(meetingPath, txtFiles[0]);
    } else {
      return await interaction.editReply({
        embeds: [embeds.invalidOptionEmbed],
        flags: MessageFlags.Ephemeral,
      });
    }

    if(fileToSend.endsWith('.md')) {
      const fileContent = fs.readFileSync(fileToSend, 'utf-8');
      await interaction.editReply(':arrow_down: Summary');
      let thread;
      if(interaction.channel.isThread()) {
        thread = interaction.channel;
      } else {
        const message = await interaction.fetchReply();
        thread = await message.startThread({ name: `Summary of the meeting '${meetingName}'` });
      }
      await utils.sendSummary(fileContent, thread);
    } else 
      await interaction.editReply({
        files: [fileToSend],
      });
  },
};