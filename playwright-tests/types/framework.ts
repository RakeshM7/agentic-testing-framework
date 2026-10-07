export type EnvironmentName = 'dev' | 'qa' | 'prod';

export interface Credentials {
  email: string;
  password: string;
}

export interface CreatedEntity {
  type: string;
  identifier: string;
  url: string;
  createdAt: string;
  note?: string;
}
