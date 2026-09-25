import { checkAgentsCli } from '../agents-policy';
import { REPO_ROOT, processIo } from '../io';

process.exitCode = checkAgentsCli(REPO_ROOT, processIo);
