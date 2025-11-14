import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
} from 'discord.js';
import fs from 'fs';
import path from 'path';

interface CommandModule {
  execute: (_interaction: ChatInputCommandInteraction) => Promise<void>;
  autocomplete?: (_interaction: AutocompleteInteraction) => Promise<void>;
}

export const data = new SlashCommandBuilder()
  .setName('meeting')
  .setDescription('Manage meetings')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('start')
      .setDescription('Starts a new meeting')
      .addStringOption((option) =>
        option.setName('name').setDescription('Name of the meeting').setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand.setName('stop').setDescription('Stops the current meeting')
  )
  .addSubcommand((subcommand) => subcommand.setName('list').setDescription('Lists all meetings'))
  .addSubcommand((subcommand) =>
    subcommand
      .setName('delete')
      .setDescription('Deletes a meeting')
      .addStringOption((option) =>
        option
          .setName('what')
          .setDescription('What to delete')
          .setRequired(true)
          .addChoices(
            { name: 'recording', value: 'recording' },
            { name: 'meeting', value: 'meeting' }
          )
      )
      .addStringOption((option) =>
        option
          .setName('name')
          .setDescription('Name of the meeting')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('send')
      .setDescription('Sends a recording, summary or transcription of the meeting')
      .addStringOption((option) =>
        option
          .setName('what')
          .setDescription('What to send')
          .setRequired(true)
          .addChoices(
            { name: 'recording', value: 'recording' },
            { name: 'summary', value: 'summary' },
            { name: 'transcription', value: 'transcription' }
          )
      )
      .addStringOption((option) =>
        option
          .setName('name')
          .setDescription('Name of the meeting')
          .setRequired(true)
          .setAutocomplete(true)
      )
  );

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const command = interaction.commandName;
  const subcommand = interaction.options.getSubcommand();
  const logicPath = path.join(__dirname, 'logic', `${command}_${subcommand}.js`);

  if (fs.existsSync(logicPath)) {
    const module = (await import(logicPath)) as CommandModule;
    if (module.autocomplete) {
      await module.autocomplete(interaction);
    } else {
      await interaction.respond([]);
    }
  } else {
    await interaction.respond([]);
  }
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const command = interaction.commandName;
  const subcommand = interaction.options.getSubcommand();
  const logicPath = path.join(__dirname, 'logic', `${command}_${subcommand}.js`);

  if (fs.existsSync(logicPath)) {
    const module = (await import(logicPath)) as CommandModule;
    await module.execute(interaction);
  } else {
    await interaction.reply(`No logic found for subcommand: ${subcommand}`);
  }
}
