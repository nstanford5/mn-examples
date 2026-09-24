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

// The attestation provider as an HTTP service. Ported from
// midnightntwrk/example-zkloan (zkloan-credit-scorer-attestation-api/src/server.ts).
//
//   POST /attest         sign {creditScore, monthlyIncome, monthsAsCustomer, userPubKeyHash}
//   GET  /provider-info  {providerId, publicKey} — what the admin registers on-chain
//   GET  /health
//
// DEMO-GRADE: it signs whatever credit data it is sent. A real provider would
// look the figures up in its own records (and authenticate the caller) rather
// than trusting the request body — the contract only proves that THIS provider
// vouched for the data, so the provider is the trust anchor.
import restify from 'restify';
import type { JubjubPoint } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { signCreditData, getPublicKey } from './signing.js';
import type { AttestationRequest, AttestationResponse, ProviderInfoResponse, HealthResponse } from './types.js';

export function createServer(providerSk: bigint, providerId: number): restify.Server {
  const server = restify.createServer({ name: 'zkloan-attestation-api' });
  server.use(restify.plugins.bodyParser());

  // Permissive CORS so a browser DApp can call the API directly.
  server.pre((req: restify.Request, res: restify.Response, next: restify.Next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.send(204);
      return next(false);
    }
    return next();
  });

  const providerPk: JubjubPoint = getPublicKey(providerSk);

  server.post('/attest', (req: restify.Request, res: restify.Response, next: restify.Next) => {
    try {
      const body = req.body as AttestationRequest;

      if (
        body?.creditScore == null ||
        body.monthlyIncome == null ||
        body.monthsAsCustomer == null ||
        body.userPubKeyHash == null
      ) {
        res.send(400, {
          error: 'Missing required fields: creditScore, monthlyIncome, monthsAsCustomer, userPubKeyHash',
        });
        return next();
      }

      const userPubKeyHash = BigInt(body.userPubKeyHash);
      const signature = signCreditData(
        providerSk,
        body.creditScore,
        body.monthlyIncome,
        body.monthsAsCustomer,
        userPubKeyHash,
      );

      const response: AttestationResponse = {
        signature: {
          announcement: {
            x: signature.announcement.x.toString(),
            y: signature.announcement.y.toString(),
          },
          response: signature.response.toString(),
        },
        message: {
          creditScore: body.creditScore.toString(),
          monthlyIncome: body.monthlyIncome.toString(),
          monthsAsCustomer: body.monthsAsCustomer.toString(),
          userPubKeyHash: userPubKeyHash.toString(),
        },
      };
      res.send(200, response);
    } catch (err) {
      res.send(500, { error: err instanceof Error ? err.message : String(err) });
    }
    return next();
  });

  server.get('/provider-info', (_req: restify.Request, res: restify.Response, next: restify.Next) => {
    const response: ProviderInfoResponse = {
      providerId,
      publicKey: { x: providerPk.x.toString(), y: providerPk.y.toString() },
    };
    res.send(200, response);
    return next();
  });

  server.get('/health', (_req: restify.Request, res: restify.Response, next: restify.Next) => {
    const response: HealthResponse = { status: 'ok', providerId };
    res.send(200, response);
    return next();
  });

  return server;
}
