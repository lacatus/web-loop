import { REPO_ROOT, processIo } from '../io';
import { tokensCli } from '../tokens';

// Transcripts are keyed by the directory Claude Code was started in: the repo root.
process.exitCode = tokensCli(process.argv.slice(2), { cwd: REPO_ROOT }, processIo);
