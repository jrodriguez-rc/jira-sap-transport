import React from 'react';
import ForgeReconciler, { Form, Label, Select, Textfield, useForm } from '@forge/react';

export const Config: React.FC = () => {
  const { register, handleSubmit } = useForm<Record<string, string>>();
  return (
    <Form onSubmit={handleSubmit(() => undefined)}>
      <Label labelFor="type">Type</Label>
      <Select
        {...register('type')}
        options={[
          { label: 'Workbench', value: 'K' },
          { label: 'Customizing', value: 'W' },
          { label: 'Copy', value: 'T' },
        ]}
      />
      <Label labelFor="target">Target (optional)</Label>
      <Textfield {...register('target')} />
      <Label labelFor="descriptionOverride">Description override (smart value)</Label>
      <Textfield {...register('descriptionOverride')} />
      <Label labelFor="email">Email</Label>
      <Textfield {...register('email')} defaultValue="{{initiator.emailAddress}}" />
    </Form>
  );
};

ForgeReconciler.render(<Config />);
