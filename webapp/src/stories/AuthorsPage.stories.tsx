import type { Meta, StoryObj } from '@storybook/react';
import { AuthorsPage } from '../pages/AuthorsPage';

const meta = {
  title: 'Screens/AuthorsPage',
  component: AuthorsPage,
  parameters: {
    layout: 'fullscreen'
  }
} satisfies Meta<typeof AuthorsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Portuguese: Story = {
  args: {
    lang: 'pt'
  }
};
