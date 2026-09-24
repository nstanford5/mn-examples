// This file is part of example-zk-loan.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// HTTP-level tests for the attestation API. Ported from midnightntwrk/example-zkloan
// (zkloan-credit-scorer-attestation-api/test/server.test.ts). Listens on port 0,
// so no network or fixed port is needed.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { createServer } from '../../../attestation-api/server.js';
import { generateKeyPair } from '../../../attestation-api/signing.js';
import type restify from 'restify';
import type {
  AttestationResponse,
  HealthResponse,
  ProviderInfoResponse,
} from '../../../attestation-api/types.js';

setNetworkId('undeployed');

describe('Attestation API Server', () => {
  let server: restify.Server;
  let baseUrl: string;
  const { sk, pk } = generateKeyPair();
  const providerId = 42;

  beforeAll(async () => {
    server = createServer(sk, providerId);
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        const port = typeof addr === 'string' ? addr : addr?.port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('GET /health returns ok status', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as HealthResponse;
    expect(body.status).toBe('ok');
    expect(body.providerId).toBe(providerId);
  });

  it('GET /provider-info returns provider public key', async () => {
    const res = await fetch(`${baseUrl}/provider-info`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ProviderInfoResponse;
    expect(body.providerId).toBe(providerId);
    expect(body.publicKey.x).toBe(pk.x.toString());
    expect(body.publicKey.y).toBe(pk.y.toString());
  });

  it('POST /attest returns valid attestation', async () => {
    const res = await fetch(`${baseUrl}/attest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creditScore: 720,
        monthlyIncome: 2500,
        monthsAsCustomer: 24,
        userPubKeyHash: '12345678901234567890',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AttestationResponse;
    expect(body.signature).toBeDefined();
    expect(body.signature.announcement).toBeDefined();
    expect(body.signature.announcement.x).toBeDefined();
    expect(body.signature.announcement.y).toBeDefined();
    expect(body.signature.response).toBeDefined();
    expect(body.message.creditScore).toBe('720');
    expect(body.message.monthlyIncome).toBe('2500');
    expect(body.message.monthsAsCustomer).toBe('24');
  });

  it('POST /attest returns 400 for missing fields', async () => {
    const res = await fetch(`${baseUrl}/attest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creditScore: 720,
        // missing other fields
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Missing required fields');
  });
});
