import Image from 'next/image';
import Link from 'next/link';

// Logo only. The page's actions sit in the hero (LandingActions), so the
// header doesn't repeat them or the section links the page body already lists.
export default function LandingHeader() {
  return (
    <header className="border-b border-lavander bg-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center px-4 sm:px-6">
        <Link href="/" aria-label="AireOS home" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet">
          <Image src="/aire-logo.png" alt="AIRE" width={72} height={29} priority />
        </Link>
      </div>
    </header>
  );
}
