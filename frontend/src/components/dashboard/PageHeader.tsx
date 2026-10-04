export function PageHeader({ titulo, descricao }: { titulo: string; descricao?: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-bold text-dash-primary">{titulo}</h1>
      {descricao && <p className="mt-1.5 max-w-3xl text-sm text-dash-muted">{descricao}</p>}
    </header>
  );
}
