import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { CityMap } from '../components/CityMap';
import type { Point } from '../types';
import { samplePoints } from './storyData';

const meta = {
  title: 'UI/CityMap',
  component: CityMap,
  parameters: {
    layout: 'fullscreen'
  }
} satisfies Meta<typeof CityMap>;

export default meta;
type Story = StoryObj<typeof meta>;

function CityMapFrame() {
  const [selected, setSelected] = useState<Point | null>(samplePoints[0]);

  return (
    <div style={{ height: 680, position: 'relative' }}>
      <CityMap points={samplePoints} selected={selected} onSelect={setSelected} />
    </div>
  );
}

export const Default: Story = {
  render: () => <CityMapFrame />
};
