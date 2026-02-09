import { ChatInputCommandInteraction, MessageFlags, TextChannel } from 'discord.js';
import state from '../../utils/state';

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (state.meetings.length === 0) {
    await interaction.reply({
      content: ':x: No meetings found',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply(':arrow_down: Meetings list');
  const message = await interaction.fetchReply();

  let thread;
  try {
    thread = await message.startThread({ name: 'Meetings list' });
  } catch (err) {
    console.warn('Could not start thread for meeting list:', (err as Error)?.message || err);
    thread = interaction.channel! as unknown as TextChannel;
  }

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
