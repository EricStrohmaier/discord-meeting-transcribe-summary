import fs from 'fs';
import path from 'path';
import config from 'config';
import dotenv from 'dotenv';
import { BotConfig } from '../types';
import { splitAudioFile, transcribe, summarize } from '../utils/utils';

dotenv.config();

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const meetingName = args[0];

  if (!meetingName) {
    console.error('Usage: node dist/scripts/reprocessMeeting.js <meetingName>');
    process.exit(1);
  }

  const MEETINGS_DIR = path.join(__dirname, '../../meetings/');
  const meetingPath = path.join(MEETINGS_DIR, meetingName);

  if (!fs.existsSync(meetingPath)) {
    console.error(`Meeting directory not found: ${meetingPath}`);
    process.exit(1);
  }

  const mp3Path = path.join(meetingPath, `${meetingName}.mp3`);
  if (!fs.existsSync(mp3Path)) {
    console.error(`MP3 file not found: ${mp3Path}`);
    process.exit(1);
  }

  const botConfig = config as unknown as BotConfig;

  console.log(`Reprocessing meeting: ${meetingName}`);
  console.log(`Using MP3: ${mp3Path}`);

  try {
    console.log('Splitting audio file...');
    const audioParts = await splitAudioFile(mp3Path, botConfig.openai.transcription_max_size_MB);
    console.log(`Audio splitting successful. Parts: ${audioParts.length}`);

    console.log('Starting transcription...');
    const transcription = await transcribe(audioParts);
    if (!transcription) {
      throw new Error('Transcription failed: empty transcription');
    }

    const transcriptionFile = path.join(meetingPath, `${meetingName}.txt`);
    fs.writeFileSync(transcriptionFile, transcription, { encoding: 'utf8' });
    console.log(`Transcription saved to: ${transcriptionFile}`);

    console.log('Starting summary generation...');
    const summary = await summarize(transcriptionFile);
    if (!summary) {
      throw new Error('Summary failed: empty summary');
    }

    const summaryFile = path.join(meetingPath, `${meetingName}.md`);
    fs.writeFileSync(summaryFile, summary, { encoding: 'utf8' });
    console.log(`Summary saved to: ${summaryFile}`);
    console.log('Reprocessing completed successfully.');
  } catch (error) {
    const err = error as Error;
    console.error('Reprocessing failed:', err.message);
    process.exit(1);
  }
}

void main();
