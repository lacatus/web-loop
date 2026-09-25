import { REPO_ROOT, processIo } from '../io';
import { parseVerifyArgs, runVerify } from '../verify-runner';

process.exitCode = runVerify({
  cwd: REPO_ROOT,
  io: processIo,
  ...parseVerifyArgs(process.argv.slice(2)),
});
