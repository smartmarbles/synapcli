import picomatch from 'picomatch';
import type { RemoteFile, SourceConfig } from '../types.js';

/**
 * Filter a list of remote files against a source's include/exclude glob patterns.
 * If no patterns are configured, all files pass through.
 */
export function filterFiles(files: RemoteFile[], source: SourceConfig): RemoteFile[] {
  let result = files;

  if (source.include && source.include.length > 0) {
    result = result.filter((f) => picomatch.isMatch(f.path, source.include!));
  }

  if (source.exclude && source.exclude.length > 0) {
    result = result.filter((f) => !picomatch.isMatch(f.path, source.exclude!));
  }

  return result;
}
