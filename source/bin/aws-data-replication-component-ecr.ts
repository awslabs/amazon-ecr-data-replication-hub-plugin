#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { DataTransferECRStack } from '../lib/aws-data-replication-component-ecr-stack';

const app = new cdk.App();
new DataTransferECRStack(app, 'DataTransferECRStack');
