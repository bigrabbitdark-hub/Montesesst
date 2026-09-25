import Link from 'next/link';
import Image from 'next/image';

export function Logo() {
  return (
    <Link href="/" className="inline-flex items-center">
      <Image
        src="/brand/logo-horizontal.jpg"
        alt="Montese SST"
        width={220}
        height={73}
        priority
        className="h-10 w-auto sm:h-11"
      />
    </Link>
  );
}
