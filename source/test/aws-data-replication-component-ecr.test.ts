import * as cdk from '@aws-cdk/core';
import '@aws-cdk/assert/jest';
import * as DataTransferECR from '../lib/aws-data-replication-component-ecr-stack';

test('Empty Stack', () => {
  const app = new cdk.App();
  // WHEN
  const stack = new DataTransferECR.DataTransferECRStack(app, 'MyTestStack');
  // THEN
  // expectCDK(stack).to(matchTemplate({
  //   "Resources": {}
  // }, MatchStyle.EXACT))


  expect(stack).toHaveResource('AWS::DynamoDB::Table', {
  });


});
