import { statusLineFromStdin } from '../statusline';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => (raw += chunk));
process.stdin.on('end', () => process.stdout.write(`${statusLineFromStdin(raw)}\n`));
