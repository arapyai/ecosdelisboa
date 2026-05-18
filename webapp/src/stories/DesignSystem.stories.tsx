import type { Meta, StoryObj } from '@storybook/react';

function DesignOverview() {
  const colors = [
    ['Paper', '#f4efe7'],
    ['Ink', '#16211f'],
    ['Green', '#163832'],
    ['Green 2', '#23564c'],
    ['Clay', '#c45732'],
    ['Blue', '#315f7d'],
    ['Line', '#d8d0c4']
  ];

  return (
    <main style={{ padding: 32, color: '#16211f' }}>
      <section style={{ maxWidth: 960 }}>
        <h1 style={{ marginTop: 0 }}>Lisboa por Outros UI</h1>
        <p style={{ color: '#69736e', lineHeight: 1.5 }}>
          Catalogo dos elementos visuais usados no PWA: selecao de idioma, player, detalhe de ponto, mapa e telas
          principais.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
          {colors.map(([name, value]) => (
            <article key={name} style={{ border: '1px solid #d8d0c4', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ height: 82, background: value }} />
              <div style={{ padding: 10, background: '#fffaf1' }}>
                <strong>{name}</strong>
                <small style={{ display: 'block', color: '#69736e' }}>{value}</small>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

const meta = {
  title: 'Design/Overview',
  component: DesignOverview,
  parameters: {
    layout: 'fullscreen'
  }
} satisfies Meta<typeof DesignOverview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {};
