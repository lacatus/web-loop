import { REPO_ROOT, processIo } from '../io';
import { routeCli } from '../route';

process.exitCode = routeCli(REPO_ROOT, process.argv.slice(2), processIo);
