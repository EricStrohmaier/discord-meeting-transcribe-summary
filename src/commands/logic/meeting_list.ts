import { ChatInputCommandInteraction, MessageFlags, GuildMember } from 'discord.js';
import config from 'config';
import state from '../../utils/state';
import { noPermissionEmbed } from '../../utils/embeds';
import { BotConfig } from '../../types';

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.member as GuildMember;
  const memberRoles = member.roles.cache.map((role) => role.name);
  const botConfig = config as unknown as BotConfig;
  const hasPermission = memberRoles.some((role) => botConfig.allowed_roles.includes(role));

  if (!hasPermission) {
    await interaction.reply({
      embeds: [noPermissionEmbed],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (state.meetings.length === 0) {
    await interaction.reply({
      content: ':x: No meetings found',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply(':arrow_down: Meetings list');
  const message = await interaction.fetchReply();

  const thread = await message.startThread({ name: 'Meetings list' });

  const formattedMeetings = state.meetings.map((meeting) => {
    const name = meeting.name.padEnd(20, ' ');
    const recorded = meeting.recorded ? '+' : '-';
    const transcribed = meeting.transcribed ? '+' : '-';
    const summarized = meeting.summarized ? '+' : '-';
    return ` ${name} | ${recorded.padEnd(8)} | ${transcribed.padEnd(11)} | ${summarized}`;
  });

  const messageText = `
 Meeting name         | Recorded | Transcribed | Summarized
----------------------|----------|-------------|------------
${formattedMeetings.join('\n')}
`;

  const lines = messageText.split('\n');
  let chunk = '```';

  for (const line of lines) {
    if ((chunk + '\n' + line + '```').length > 2000) {
      chunk += '```';
      await thread.send(chunk);
      chunk = '```\n' + line;
    } else {
      chunk += '\n' + line;
    }
  }

  chunk += '```';
  await thread.send(chunk);
}
