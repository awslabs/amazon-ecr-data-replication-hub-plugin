/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import * as AWS from "aws-sdk";

/**
 * This lambda should be triggered when stack is created or updated.
 * The purpose is to ensure replication task is started immediately (step functions is triggered) on create or update
 * Ideally, the step functions should be triggered by event bridge rule, but this doesn't work all the time.
 * This is a workaround to resolve the issue.
 *
 * @param event:any - Not used.
 */

exports.handler = async (event: any) => {
    const stateMachineArn: string = process.env.STATE_MACHINE_ARN ? process.env.STATE_MACHINE_ARN : 'null'

    const sfn = new AWS.StepFunctions();

    var queryParams = {
        stateMachineArn: stateMachineArn,
        statusFilter: 'RUNNING'
    };

    var execParams = {
        stateMachineArn: stateMachineArn,
    };

    // Check if any running executions
    const list = await sfn.listExecutions(queryParams).promise();
    console.log(list.executions);

    if (list.executions.length == 0) {
        //if not, start a new one
        const executionArn = await sfn.startExecution(execParams).promise();
        console.log(executionArn);
    }


}