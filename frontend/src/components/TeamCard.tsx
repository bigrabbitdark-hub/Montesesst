import Image from 'next/image';
import { Linkedin, User } from 'lucide-react';
import type { TeamMember } from '@/lib/team';

export function TeamCard({ member }: { member: TeamMember }) {
  const detalhes = [member.registro, member.experiencia, member.cidade].filter(
    (item): item is string => Boolean(item),
  );

  return (
    <li className="group overflow-hidden rounded-3xl border border-brand-100 bg-white transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-brand-900/10">
      <div className="relative flex aspect-[4/5] items-center justify-center bg-gradient-to-br from-brand-100 to-brand-50">
        {member.photo ? (
          <Image
            src={member.photo}
            alt={member.name ? `Foto de ${member.name}` : ''}
            fill
            sizes="(min-width: 1024px) 30vw, 100vw"
            className="object-cover object-top"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-brand-500/70">
            <User size={64} strokeWidth={1.25} aria-hidden="true" />
            <span className="text-xs font-medium">Foto em breve</span>
          </div>
        )}
      </div>
      <div className="flex items-start justify-between gap-3 p-6">
        <div>
          <h3 className={`text-lg font-semibold ${member.name ? 'text-brand-900' : 'text-muted'}`}>
            {member.name ?? 'Nome em breve'}
          </h3>
          <p className="mt-1 text-[14px] font-medium leading-snug text-brand-700">{member.role}</p>
          {detalhes.length > 0 && (
            <p className="mt-1 text-[13px] leading-snug text-ink/70">{detalhes.join(' · ')}</p>
          )}
          <p className="mt-3 text-[14px] leading-relaxed text-ink/80">{member.paraOCliente}</p>
          {member.frasePessoal && (
            <p className="mt-3 text-[14px] italic leading-relaxed text-ink/70">“{member.frasePessoal}”</p>
          )}
        </div>
        {member.linkedin ? (
          <a
            href={member.linkedin}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`LinkedIn de ${member.name ?? 'membro da equipe'}`}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-brand-100 text-brand-700 transition-colors hover:bg-brand-700 hover:text-white"
          >
            <Linkedin size={16} aria-hidden="true" />
          </a>
        ) : (
          <span
            role="img"
            aria-label="LinkedIn (em breve)"
            title="LinkedIn — em breve"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-brand-100 text-brand-700 opacity-40"
          >
            <Linkedin size={16} aria-hidden="true" />
          </span>
        )}
      </div>
    </li>
  );
}
