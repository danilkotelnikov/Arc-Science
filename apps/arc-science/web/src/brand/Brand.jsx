import React from 'react';
import {LOCKUP_LETTERS, LOCKUP_TILE, LOCKUP_VIEWBOX, LOCKUP_WORD} from './logo.js';

/**
 * The Arc Science lockup: the "as" tile and ARC SCIENCE in MuseoModerno Black, outlined by
 * scripts/build-logo.py. Its three fills are --logo-tile, --logo-letters and --logo-word
 * (app.css), so each palette colours it from the production files' two colourways.
 */
export function Brand({className = ''}) {
  return (
    <svg className={'ar-brand ' + className} viewBox={LOCKUP_VIEWBOX} role="img" aria-label="Arc Science" focusable="false">
      <path className="ar-brand-tile" d={LOCKUP_TILE} />
      <path className="ar-brand-letters" d={LOCKUP_LETTERS} />
      <path className="ar-brand-word" d={LOCKUP_WORD} />
    </svg>
  );
}
