import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import ffmpeg from 'ffmpeg-static';
import OpenAI from 'openai';
import config from 'config';
import state from './state';
import { BotConfig } from '../types';
import { ThreadChannel, TextChannel, NewsChannel } from 'discord.js';

const getAudioDuration = async (filePath: string): Promise<number> => {
  return new Promise((resolve, reject) => {
    if (!ffmpeg) {
      return reject(new Error('FFmpeg binary not found'));
    }

    const ffmpegProcess = spawn(ffmpeg, ['-i', filePath, '-f', 'null', '-']);

    let duration = 0;
    ffmpegProcess.stderr.on('data', (data: Buffer) => {
      const output = data.toString();
      const durationMatch = output.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
      if (durationMatch) {
        const hours = parseFloat(durationMatch[1]);
        const minutes = parseFloat(durationMatch[2]);
        const seconds = parseFloat(durationMatch[3]);
        duration = hours * 3600 + minutes * 60 + seconds;
      }
    });

    ffmpegProcess.on('close', (code) => {
      if (code === 0) {
        resolve(duration);
      } else {
        reject(new Error('Failed to get audio duration'));
      }
    });

    ffmpegProcess.on('error', (err) => {
      reject(err);
    });
  });
};

export const cleanupRecording = async (): Promise<void> => {
  if (state.mixingInterval) {
    clearInterval(state.mixingInterval);
    state.mixingInterval = null;
  }

  if (state.userBuffers && state.recordingProcess) {
    const chunkSize = 48000 * 2 * (20 / 1000);
    const mixedBuffer = Buffer.alloc(chunkSize);
    const mixedSamples = new Int16Array(mixedBuffer.buffer, mixedBuffer.byteOffset, chunkSize / 2);
    mixedSamples.fill(0);

    for (const [, user] of state.userBuffers) {
      const available = user.buffer.length - user.position;
      if (available > 0) {
        const chunk = user.buffer.subarray(user.position, user.position + available);
        const userSamples = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.length / 2);
        for (let i = 0; i < userSamples.length; i++) {
          const sum = mixedSamples[i] + userSamples[i];
          mixedSamples[i] = Math.max(-32768, Math.min(32767, sum));
        }
      }
    }

    if (state.recordingProcess.stdin && !state.recordingProcess.stdin.destroyed) {
      state.recordingProcess.stdin.write(mixedBuffer);
    }
  }

  if (state.recordingProcess) {
    if (state.recordingProcess.stdin && !state.recordingProcess.stdin.destroyed) {
      state.recordingProcess.stdin.end();
    }

    // Wait for FFmpeg to close, but don't hang forever on long recordings.
    await Promise.race<void>([
      new Promise<void>((resolve) => {
        state.recordingProcess!.on('close', () => resolve());
      }),
      new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (state.recordingProcess) {
            state.recordingProcess.kill('SIGKILL');
          }
          resolve();
        }, 15000);
        state.recordingProcess!.once('close', () => clearTimeout(timeout));
      }),
    ]);

    state.recordingProcess = null;
  }

  if (state.userStreams) {
    for (const [, streamInfo] of state.userStreams) {
      if (streamInfo.audioStream) streamInfo.audioStream.destroy();
      if (streamInfo.opusDecoder) streamInfo.opusDecoder.destroy();
      if (streamInfo.pcmStream) streamInfo.pcmStream.destroy();
    }
    state.userStreams.clear();
    state.userStreams = null;
  }

  if (state.userBuffers) {
    state.userBuffers.clear();
    state.userBuffers = null;
  }

  if (state.connection) {
    state.connection.destroy();
    state.connection = null;
  }
};

export const convertOggToMp3 = async (oggPath: string, mp3Path: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (!ffmpeg) {
      return reject(new Error('FFmpeg binary not found'));
    }

    const ffmpegProcess = spawn(
      ffmpeg,
      ['-i', oggPath, '-codec:a', 'libmp3lame', '-q:a', '2', '-y', mp3Path],
      {
        stdio: ['ignore', 'ignore', 'ignore'],
      }
    );

    ffmpegProcess.on('close', (code) => {
      if (code === 0) {
        console.log('OGG to MP3 conversion complete.');
        resolve();
      } else {
        console.error('OGG to MP3 conversion failed!');
        reject(new Error('FFmpeg conversion failed'));
      }
    });

    ffmpegProcess.on('error', (err) => {
      console.error('FFmpeg conversion error:', err);
      reject(err);
    });
  });
};

export const splitAudioFile = async (
  filePath: string,
  maxFileSize_MB: number
): Promise<string[]> => {
  const maxFileSize_Bytes = maxFileSize_MB * 1024 * 1024;
  const fileExtension = path.extname(filePath).toLowerCase();

  if (fileExtension !== '.mp3') {
    throw new Error('Unsupported file format. Only MP3 files are supported.');
  }

  if (!fs.existsSync(filePath)) {
    throw new Error('File does not exist.');
  }

  const fileStats = fs.statSync(filePath);
  const fileSize = fileStats.size;

  if (fileSize <= maxFileSize_Bytes) {
    return [filePath];
  }

  if (!ffmpeg) {
    throw new Error('FFmpeg binary not found');
  }

  const duration = await getAudioDuration(filePath);
  const partDuration = (maxFileSize_Bytes / fileSize) * duration;

  const partFiles: string[] = [];
  let startTime = 0;

  const baseName = path.basename(filePath, fileExtension);
  const dirName = path.dirname(filePath);

  while (startTime < duration) {
    const partFilePath = path.join(
      dirName,
      `${baseName}_part${partFiles.length + 1}${fileExtension}`
    );

    const ffmpegProcess = spawn(
      ffmpeg,
      [
        '-i',
        filePath,
        '-ss',
        startTime.toFixed(2),
        '-t',
        partDuration.toFixed(2),
        '-c',
        'copy',
        '-y',
        partFilePath,
      ],
      {
        stdio: ['ignore', 'ignore', 'ignore'],
      }
    );

    await new Promise<void>((resolve, reject) => {
      ffmpegProcess.on('close', (code) => {
        if (code === 0) {
          partFiles.push(partFilePath);
          resolve();
        } else {
          reject(new Error('FFmpeg split failed'));
        }
      });

      ffmpegProcess.on('error', (err) => {
        reject(err);
      });
    });

    startTime += partDuration;
  }

  return partFiles;
};

export const transcribe = async (audioParts: string[]): Promise<string> => {
  let fullTranscription = '';

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('Missing OPENAI_API_KEY');
  }
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const botConfig = config as unknown as BotConfig;

  try {
    const maxRetries = 3;
    const baseDelayMs = 1000;

    const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

    for (const filePath of audioParts) {
      let attempt = 0;
      let partTranscriptionText = '';

      while (attempt < maxRetries) {
        attempt += 1;

        try {
          console.log(`Transcribing audio part ${filePath} (attempt ${attempt}/${maxRetries})...`);

          const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(filePath),
            model: botConfig.openai.transcription_model,
            language: botConfig.openai.transcription_language,
          });

          partTranscriptionText = transcription.text;
          console.log(
            `Transcription of audio part ${filePath} successful (attempt ${attempt}/${maxRetries}).`
          );
          break;
        } catch (e) {
          const err = e as Error;
          const message = err.message || '';
          const name = err.name || '';

          const isConnectionError =
            name === 'APIConnectionError' ||
            name === 'APIConnectionTimeoutError' ||
            /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|Connection error/i.test(message);

          console.error(
            `Error transcribing audio part ${filePath} on attempt ${attempt}:`,
            message
          );

          if (!isConnectionError || attempt >= maxRetries) {
            throw err;
          }

          const backoff = baseDelayMs * Math.pow(2, attempt - 1);
          console.log(
            `Connection error detected, retrying transcription for part ${filePath} in ${backoff}ms...`
          );
          await delay(backoff);
        }
      }

      if (partTranscriptionText) {
        fullTranscription += partTranscriptionText + ' ';
      }

      if (audioParts.length > 1 && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    console.log('All audio parts transcribed successfully.');
    return fullTranscription.trim();
  } catch (e) {
    console.error('Error transcribing audio:', (e as Error).message);
    throw new Error('Transcription failed');
  }
};

export const summarize = async (transcriptionPath: string): Promise<string> => {
  try {
    const transcription = fs.readFileSync(transcriptionPath, 'utf-8');
    const botConfig = config as unknown as BotConfig;

    const messages = [
      { role: 'system' as const, content: botConfig.openai.system_content.join('') },
      {
        role: 'user' as const,
        content: `${botConfig.openai.user_content}${transcription}`,
      },
    ];

    if (!process.env.OPENAI_API_KEY) {
      throw new Error('Missing OPENAI_API_KEY');
    }
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await openai.chat.completions.create({
      model: botConfig.openai.summary_model,
      messages: messages,
    });

    return response.choices[0].message.content || '';
  } catch (e) {
    console.error('Error while summarizing:', (e as Error).message);
    throw new Error('Summary failed');
  }
};

export const sendSummary = async (
  message: string,
  channel: ThreadChannel | TextChannel | NewsChannel
): Promise<void> => {
  const lines = message.split('\n');
  let messageChunk = '';

  for (const line of lines) {
    if ((messageChunk + '\n' + line).length > 2000) {
      await channel.send(messageChunk);
      messageChunk = line;
    } else {
      messageChunk += (messageChunk ? '\n' : '') + line;
    }
  }
  if (messageChunk) {
    await channel.send(messageChunk);
  }
};
