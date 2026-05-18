import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { PointSheet } from '../components/PointSheet';
import { samplePoint } from './storyData';

const meta = {
  title: 'UI/PointSheet',
  component: PointSheet,
  parameters: {
    layout: 'fullscreen'
  }
} satisfies Meta<typeof PointSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

function PointSheetFrame() {
  const [open, setOpen] = useState(true);

  return (
    <div style={{ minHeight: 640, position: 'relative', background: '#d8d0c4' }}>
      {open ? <PointSheet point={samplePoint} lang="pt" onClose={() => setOpen(false)} /> : null}
      {!open ? (
        <button className="primary-action" type="button" onClick={() => setOpen(true)} style={{ margin: 24 }}>
          Abrir detalhe
        </button>
      ) : null}
    </div>
  );
}

export const Default: Story = {
  render: () => <PointSheetFrame />
};
