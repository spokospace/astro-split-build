// Every failure the core raises on purpose carries a stable `code`, so a
// caller can tell "the build command failed" from "a page points at a missing
// bundle" without parsing messages. Extra fields (`target`, `hook`, `missing`,
// `status`) ride along on `details` and are copied onto the error itself.

/**
 * @typedef {'INVALID_CONFIG'|'BUILD_FAILED'|'HOOK_FAILED'|'COPY_FAILED'|'MISSING_TARGET_OUTPUT'|'OUT_DIR_MISSING'|'BROKEN_ASSET_REFS'|'BROKEN_INTERNAL_LINKS'|'PAGE_CHECK_FAILED'} SplitBuildErrorCode
 */

export class SplitBuildError extends Error {
  /**
   * @param {SplitBuildErrorCode} code
   * @param {string} message
   * @param {Record<string, unknown> & { cause?: unknown }} [details]
   */
  constructor(code, message, details = {}) {
    const { cause, ...rest } = details;
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'SplitBuildError';
    this.code = code;
    Object.assign(this, rest);
  }
}
