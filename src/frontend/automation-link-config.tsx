import React from 'react';
import ForgeReconciler, { Form, Label, Textfield, useForm } from '@forge/react';

const Config: React.FC = () => {
  const { register, handleSubmit } = useForm<Record<string, string>>();
  return (
    <Form onSubmit={handleSubmit(() => undefined)}>
      <Label labelFor="requestId">Request id</Label>
      <Textfield {...register('requestId')} />
    </Form>
  );
};

ForgeReconciler.render(<Config />);
