import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
/** Package root (directory containing package.json) */
export const PKG_ROOT = join(dirname(__filename), '..');
