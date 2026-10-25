import Image from 'next/image';

import { cn } from '@/lib/utils';

import styles from './PackshotBackdrop.module.css';

const PACKSHOT_ROWS = [
  [
    '/packshots/regular-sm.webp',
    '/packshots/regular-l-carton.webp',
    '/packshots/regular-xl.webp',
    '/packshots/regular-sm-carton.webp',
    '/packshots/regular-l.webp',
    '/packshots/regular-xl-carton.webp',
  ],
  [
    '/packshots/ultra-xl-carton.webp',
    '/packshots/ultra-sm.webp',
    '/packshots/ultra-l-carton.webp',
    '/packshots/ultra-xl.webp',
    '/packshots/ultra-sm-carton.webp',
    '/packshots/ultra-l.webp',
  ],
  [
    '/packshots/tape-l.webp',
    '/packshots/tape-xl-carton.webp',
    '/packshots/tape-sm.webp',
    '/packshots/tape-l-carton.webp',
    '/packshots/tape-xl.webp',
    '/packshots/tape-sm-carton.webp',
  ],
];

function PackshotGroup({ images, duplicate = false }) {
  return (
    <div className={styles.group} aria-hidden={duplicate || undefined}>
      {images.map((src) => (
        <Image
          key={`${duplicate ? 'duplicate-' : ''}${src}`}
          src={src}
          alt=""
          width={150}
          height={150}
          sizes="(max-width: 639px) 88px, (max-width: 1279px) 120px, 150px"
          className={styles.packshot}
          draggable={false}
        />
      ))}
    </div>
  );
}

export function PackshotBackdrop() {
  return (
    <div className={styles.backdrop} aria-hidden="true">
      {PACKSHOT_ROWS.map((images, index) => (
        <div
          key={images[0]}
          className={cn(styles.row, styles[`row${index + 1}`])}
        >
          <div className={cn(styles.track, index % 2 === 1 && styles.reverse)}>
            <PackshotGroup images={images} />
            <PackshotGroup images={images} duplicate />
          </div>
        </div>
      ))}
    </div>
  );
}
