import { VoiceConnection } from '@discordjs/voice';
import { ChildProcess } from 'child_process';
import { Readable } from 'stream';
import * as prism from 'prism-media';

export interface Meeting {
  name: string;
  recorded: boolean;
  transcribed: boolean;
  summarized: boolean;
}

export interface UserBuffer {
  buffer: Buffer;
  position: number;
}

export interface UserStreamInfo {
  audioStream: Readable;
  opusDecoder: prism.opus.Decoder;
  pcmStream: Readable;
}

export interface BotState {
  currentMeeting: string | null;
  connection: VoiceConnection | null;
  recordingProcess: ChildProcess | null;
  mixingInterval: NodeJS.Timeout | null;
  userBuffers: Map<string, UserBuffer> | null;
  userStreams: Map<string, UserStreamInfo> | null;
  meetings: Meeting[];
}

export interface AudioSettings {
  channels: number;
  rate: number;
  frameSize: number;
  bitrate: string;
  mixInterval: number;
}

export interface OpenAIConfig {
  user_content: string;
  system_content: string[];
  summary_model: string;
  transcription_model: string;
  transcription_language: string;
  transcription_max_size_MB: number;
}

export interface BotConfig {
  openai: OpenAIConfig;
  allowed_roles: string[];
}
