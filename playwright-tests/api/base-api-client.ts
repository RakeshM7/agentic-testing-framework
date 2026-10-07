import { APIRequestContext, APIResponse } from '@playwright/test';
import { env } from '../config/env';

export interface ApiRequestOptions {
  timeout?: number;
  headers?: Record<string, string>;
  data?: unknown;
}

export class BaseApiClient {
  constructor(
    protected readonly request: APIRequestContext,
    protected readonly baseUrl: string = env.urls.eventHubApi
  ) {}

  protected url(path: string): string {
    return `${this.baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  }

  protected async get(path: string, options: ApiRequestOptions = {}): Promise<APIResponse> {
    return this.request.get(this.url(path), {
      timeout: options.timeout ?? env.timeouts.api,
      headers: options.headers,
    });
  }

  protected async post(path: string, options: ApiRequestOptions = {}): Promise<APIResponse> {
    return this.request.post(this.url(path), {
      timeout: options.timeout ?? env.timeouts.api,
      headers: options.headers,
      data: options.data,
    });
  }
}
