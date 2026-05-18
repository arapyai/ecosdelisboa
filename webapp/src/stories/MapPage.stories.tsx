import type { Meta, StoryObj } from '@storybook/react';
import { MapPage } from '../pages/MapPage';

const meta = {
  title: 'Screens/MapPage',
  component: MapPage,
  parameters: {
    layout: 'fullscreen'
  }
} satisfies Meta<typeof MapPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Portuguese: Story = {
  args: {
    lang: 'pt'
  }
};

export const English: Story = {
  args: {
    lang: 'en'
  }
};
