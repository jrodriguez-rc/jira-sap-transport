import React from 'react';
import ForgeReconciler, { Form, Label, Select, Textfield, useForm } from '@forge/react';

const Config: React.FC = () => {
  const { register, handleSubmit } = useForm<Record<string, string>>();
  return (
    <Form onSubmit={handleSubmit(() => undefined)}>
      <Label labelFor="mode">Mode</Label>
      <Select
        {...register('mode')}
        options={[
          { label: 'All linked', value: 'all-linked' },
          { label: 'By id', value: 'by-id' },
          { label: 'Latest', value: 'latest' },
        ]}
      />
      <Label labelFor="requestId">Request id (only for "By id")</Label>
      <Textfield {...register('requestId')} />
      <Label labelFor="onlyType">Only type (for "All linked")</Label>
      <Select
        {...register('onlyType')}
        options={[
          { label: 'Any', value: 'any' },
          { label: 'Workbench', value: 'K' },
          { label: 'Customizing', value: 'W' },
          { label: 'Copy', value: 'T' },
        ]}
      />
    </Form>
  );
};

ForgeReconciler.render(<Config />);
