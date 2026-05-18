import type { Meta, StoryObj } from '@storybook/react';
import { RoutesPage } from '../pages/RoutesPage';

const meta = {
  title: 'Screens/RoutesPage',
  component: RoutesPage,
  parameters: {
    layout: 'fullscreen'
  }
} satisfies Meta<typeof RoutesPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Portuguese: Story = {
  args: {
    lang: 'pt'
  }
};
