import type { Meta, StoryObj } from '@storybook/react';
import { AudioPlayer } from '../components/AudioPlayer';
import { samplePoint } from './storyData';

const meta = {
  title: 'UI/AudioPlayer',
  component: AudioPlayer,
  parameters: {
    layout: 'centered'
  },
  decorators: [
    (Story) => (
      <div style={{ width: 420 }}>
        <Story />
      </div>
    )
  ]
} satisfies Meta<typeof AudioPlayer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithTranscript: Story = {
  args: {
    label: 'Ouvir',
    track: samplePoint.audios?.[0]
  }
};

export const PreviewOnly: Story = {
  args: {
    label: 'Listen',
    track: undefined
  }
};
