import {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import http from 'http';
import state from './utils/state';
import dotenv from 'dotenv';

dotenv.config();

const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || '3000', 10);
let botReady = false;

interface Command {
  data: {
    name: string;
    toJSON: () => unknown;
  };
  execute: (_interaction: ChatInputCommandInteraction) => Promise<void>;
  autocomplete?: (_interaction: AutocompleteInteraction) => Promise<void>;
}

declare module 'discord.js' {
  export interface Client {
    commands: Collection<string, Command>;
  }
}

async function initializeBot() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });

  // Load commands to collection
  client.commands = new Collection<string, Command>();

  const commandsPath = path.join(__dirname, 'commands');
  const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));

  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = (await import(filePath)) as Command;

    if ('data' in command && 'execute' in command) {
      client.commands.set(command.data.name, command);
    } else {
      console.log(
        `[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`
      );
    }
  }

  // Sync commands with the server
  const rest = new REST().setToken(process.env.TOKEN!);
  const commands = Array.from(client.commands.values()).map((value) => value.data.toJSON());

  try {
    console.log(`Started refreshing ${commands.length} application (/) commands.`);

    const data = (await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID!, process.env.GUILD_ID!),
      { body: commands }
    )) as unknown[];

    console.log(`Successfully reloaded ${data.length} application (/) commands.`);
  } catch (error) {
    console.error(error);
  }

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);
    botReady = true;
  });

  // Auto-reconnect on unexpected disconnect
  client.on('error', (error) => {
    console.error('Discord client error:', error.message);
  });

  client.on('warn', (warning) => {
    console.warn('Discord client warning:', warning);
  });

  client.on(Events.ShardDisconnect, (event, shardId) => {
    console.warn(
      `Shard ${shardId} disconnected (code ${event.code}). Discord.js will auto-reconnect.`
    );
  });

  client.on(Events.ShardReconnecting, (shardId) => {
    console.log(`Shard ${shardId} reconnecting...`);
  });

  client.on(Events.ShardResume, (shardId, replayedEvents) => {
    console.log(`Shard ${shardId} resumed. Replayed ${replayedEvents} events.`);
  });

  // Load available meetings
  const MEETINGS_DIR = path.join(__dirname, '..', 'meetings/');
  if (!fs.existsSync(MEETINGS_DIR)) fs.mkdirSync(MEETINGS_DIR, { recursive: true });

  const files = fs.readdirSync(MEETINGS_DIR);
  const directories = files.filter((file) =>
    fs.statSync(path.join(MEETINGS_DIR, file)).isDirectory()
  );

  state.meetings = directories.map((dir) => {
    const meetingPath = path.join(MEETINGS_DIR, dir);
    const meetingFiles = fs.readdirSync(meetingPath);

    return {
      name: dir,
      recorded: meetingFiles.some((file) => file.endsWith('.mp3') || file.endsWith('.ogg')),
      transcribed: meetingFiles.some((file) => file.endsWith('.txt')),
      summarized: meetingFiles.some((file) => file.endsWith('.md')),
    };
  });

  // Handle commands and autocompletions
  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);

      if (!command) {
        console.error(`No command found: ${interaction.commandName}`);
        return;
      }

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(error);
      }
    } else if (interaction.isAutocomplete()) {
      const command = interaction.client.commands.get(interaction.commandName);

      if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
      }

      try {
        if (command.autocomplete) {
          await command.autocomplete(interaction);
        }
      } catch (error) {
        console.error(error);
      }
    }
  });

  await client.login(process.env.TOKEN);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}. Shutting down gracefully...`);
    botReady = false;
    try {
      client.destroy();
    } catch (e) {
      console.error('Error during client destroy:', e);
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Health check HTTP server for Coolify / Docker
const healthServer = http.createServer((_req, res) => {
  if (botReady) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
  } else {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'starting' }));
  }
});

healthServer.listen(HEALTH_PORT, () => {
  console.log(`Health check server listening on port ${HEALTH_PORT}`);
});

// Global crash recovery — log but don't exit
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

initializeBot().catch(console.error);
