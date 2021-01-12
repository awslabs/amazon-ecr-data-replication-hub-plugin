import * as cdk from '@aws-cdk/core';
import * as sfn from '@aws-cdk/aws-stepfunctions';
import * as tasks from '@aws-cdk/aws-stepfunctions-tasks';
import * as lambda from '@aws-cdk/aws-lambda';
import * as cr from '@aws-cdk/custom-resources';
import * as ecs from '@aws-cdk/aws-ecs';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecr from '@aws-cdk/aws-ecr';
import * as ssm from '@aws-cdk/aws-ssm';
import * as ddb from '@aws-cdk/aws-dynamodb';
import * as sns from '@aws-cdk/aws-sns';
import * as subscriptions from '@aws-cdk/aws-sns-subscriptions';
import { Rule, Schedule } from '@aws-cdk/aws-events';
import { SfnStateMachine } from '@aws-cdk/aws-events-targets';
import * as iam from '@aws-cdk/aws-iam';

import * as path from 'path';

const { VERSION } = process.env;

export class AwsDataReplicationComponentEcrStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    const sourceType = new cdk.CfnParameter(this, 'sourceType', {
      description: 'Source Type',
      type: 'String',
      default: 'Amazon_ECR',
      allowedValues: ['Amazon_ECR', 'Public']
    })

    // Only required for ECR
    const srcRegion = new cdk.CfnParameter(this, 'srcRegion', {
      description: 'Source AWS Region',
      type: 'String',
      default: '',
    })

    // Only required for ECR
    const srcAccountId = new cdk.CfnParameter(this, 'srcAccountId', {
      description: 'Source AWS Account ID',
      type: 'String',
      default: '',
    })

    //
    const srcList = new cdk.CfnParameter(this, 'srcList', {
      description: 'Type of Source Image List',
      type: 'String',
      default: 'ALL',
      allowedValues: ['ALL', 'SELECTED']
    })

    const srcImageList = new cdk.CfnParameter(this, 'srcImageList', {
      description: 'Source Image List delimited by comma',
      type: 'String',
      default: '',
    })

    // Currently, only required if source type is ECR
    const srcCredential = new cdk.CfnParameter(this, 'srcCredential', {
      description: 'Source Credentials Parameter in System Managers',
      type: 'String',
      default: '',
    })


    const destRegion = new cdk.CfnParameter(this, 'destRegion', {
      description: 'Destination AWS Region',
      type: 'String',
    })

    const destAccountId = new cdk.CfnParameter(this, 'destAccountId', {
      description: 'Destination AWS Account ID',
      type: 'String',
      default: '',
    })

    const destPrefix = new cdk.CfnParameter(this, 'destPrefix', {
      description: 'Destination Repo Prefix',
      type: 'String',
      default: '',
    })

    const destCredential = new cdk.CfnParameter(this, 'destCredential', {
      description: 'Destination Credentials Parameter in System Managers',
      type: 'String',
      default: '',
    })

    const ecsClusterName = new cdk.CfnParameter(this, 'ecsClusterName', {
      description: 'ECS Cluster Name to run ECS task',
      type: 'String'
    })

    const ecsVpcId = new cdk.CfnParameter(this, 'ecsVpcId', {
      description: 'VPC ID to run ECS task',
      type: 'AWS::EC2::VPC::Id'
    })

    // const ecsSubnets = new cdk.CfnParameter(this, 'ecsSubnets', {
    //   description: 'Subnet IDs to run ECS task. Please provide two subnets at least delimited by comma, e.g. subnet-97bfc4cd,subnet-7ad7de32',
    //   default: '',
    //   type: 'List<AWS::EC2::Subnet::Id>'
    // })

    const ecsSubnetA = new cdk.CfnParameter(this, 'ecsSubnetA', {
      description: 'Subnet IDs to run ECS task.',
      type: 'AWS::EC2::Subnet::Id'
    })

    const ecsSubnetB = new cdk.CfnParameter(this, 'ecsSubnetB', {
      description: 'Subnet IDs to run ECS task.',
      type: 'AWS::EC2::Subnet::Id'
    })

    const alarmEmail = new cdk.CfnParameter(this, 'alarmEmail', {
      description: 'alarm Email address',
      // default: '',
      allowedPattern: '\\w[-\\w.+]*@([A-Za-z0-9][-A-Za-z0-9]+\\.)+[A-Za-z]{2,14}',
      type: 'String',
    })

    this.templateOptions.description = `(SO8003) - Data Replication Hub - ECR Plugin - Template version ${VERSION}`;

    this.templateOptions.metadata = {
      'AWS::CloudFormation::Interface': {
        ParameterGroups: [
          {
            Label: { default: 'Type' },
            Parameters: [sourceType.logicalId]
          },
          {
            Label: { default: 'Source' },
            Parameters: [srcRegion.logicalId, srcAccountId.logicalId, srcList.logicalId, srcImageList.logicalId, srcCredential.logicalId]
          },
          {
            Label: { default: 'Destination' },
            Parameters: [destRegion.logicalId, destAccountId.logicalId, destPrefix.logicalId, destCredential.logicalId]
          },
          {
            Label: { default: 'ECS Cluster' },
            Parameters: [ecsClusterName.logicalId, ecsVpcId.logicalId, ecsSubnetA.logicalId, ecsSubnetB.logicalId]
          },
          {
            Label: { default: 'Advanced Options' },
            Parameters: [alarmEmail.logicalId]
          },
        ],
        ParameterLabels: {
          [sourceType.logicalId]: {
            default: 'Choose type of source container registry, for example Amazon_ECR, or Public from Docker Hub, gco.io, etc.'
          },
          [srcRegion.logicalId]: {
            default: 'Source AWS Region (only required if source type is Amazon ECR), for example, us-west-1'
          },
          [srcAccountId.logicalId]: {
            default: 'Source AWS Account ID (only required if source type is Amazon ECR), leave it blank if source is in current account'
          },
          [srcList.logicalId]: {
            default: 'Source Image Type, either ALL or SELECTED'
          },
          [srcImageList.logicalId]: {
            default: 'Selected Image List delimited by comma, for example, ubuntu:latest,alpine:latest...'
          },
          [srcCredential.logicalId]: {
            default: 'The Parameter in System Managers used to keep credentials to pull images from source'
          },
          [destRegion.logicalId]: {
            default: 'Destination AWS Region Name, for example, cn-north-1'
          },
          [destAccountId.logicalId]: {
            default: 'Destination AWS Account ID, leave it blank if destination is in current account'
          },
          [destPrefix.logicalId]: {
            default: 'Destination Repo Prefix'
          },
          [destCredential.logicalId]: {
            default: 'The Parameter in System Managers used to keep destination credentials to push images to Amazon ECR'
          },
          [ecsClusterName.logicalId]: {
            Default: 'ECS Cluster Name to run Fargate task'
          },
          [ecsVpcId.logicalId]: {
            Default: 'VPC ID to run Fargate task'
          },
          [ecsSubnetA.logicalId]: {
            Default: 'Subnet IDs to run Fargate task'
          },
          [ecsSubnetB.logicalId]: {
            Default: 'Subnet IDs to run Fargate task'
          },
          [alarmEmail.logicalId]: {
            default: 'Alarm Email address to receive notification in case of any failure'
          },

        }
      }
    }

    const isSelectedImage = new cdk.CfnCondition(this, 'isSelectedImage', {
      expression: cdk.Fn.conditionEquals('SELECTED', srcList),
    });

    // const isSourcePublic = new cdk.CfnCondition(this, 'isSourcePublic', {
    //   expression: cdk.Fn.conditionEquals('Public', sourceType),
    // });

    const isSrcInCurrentAccount = new cdk.CfnCondition(this, 'isSrcInCurrentAccount', {
      expression: cdk.Fn.conditionAnd(
        // Source Account ID is blank
        cdk.Fn.conditionEquals('', srcAccountId),
        // Source Type is Amazon ECR
        cdk.Fn.conditionEquals('Amazon_ECR', sourceType)),

    });

    const isDestInCurrentAccount = new cdk.CfnCondition(this, 'isDestInCurrentAccount', {
      // Destination in Current Account
      expression: cdk.Fn.conditionEquals('', destAccountId),
    });

    const selectedImages = cdk.Fn.conditionIf(isSelectedImage.logicalId, srcImageList.valueAsString, 'Not Applicable').toString();


    // Set up SSM for selected image list
    const selectedImageParam = new ssm.StringParameter(this, 'selectedImageParam', {
      description: `Parameter to store the selected image list delimited by comma for stack ${cdk.Aws.STACK_NAME}`,
      // parameterName: 'SelectedImageList',
      stringValue: selectedImages,
    });

    // const cfnParam = selectedImageParam.node.defaultChild as ssm.CfnParameter
    // cfnParam.cfnOptions.condition = isSelectedImage

    // Setup DynamoDB
    const imageTable = new ddb.Table(this, 'ECRMigrationTable', {
      partitionKey: { name: 'Image', type: ddb.AttributeType.STRING },
      sortKey: { name: 'Tag', type: ddb.AttributeType.STRING },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    })

    const listImagesLambda = new lambda.Function(this, 'ListImagesFunction', {
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      memorySize: 256,
      timeout: cdk.Duration.minutes(15),
      // tracing: lambda.Tracing.ACTIVE,
      environment: {
        SOURCE_TYPE: sourceType.valueAsString,
        SRC_ACCOUNT_ID: srcAccountId.valueAsString,
        SRC_LIST: srcList.valueAsString,
        SRC_REGION: srcRegion.valueAsString,
        SRC_CREDENTIAL: srcCredential.valueAsString,
        SELECTED_IMAGE_PARAM: selectedImageParam.parameterName,
      }
    });

    listImagesLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "ecr:DescribeRepositories",
          "ecr:DescribeImages",
        ],
        resources: [
          `arn:${cdk.Aws.PARTITION}:ecr:${srcRegion.valueAsString}:${cdk.Aws.ACCOUNT_ID}:repository/*`
        ]
      })
    );

    selectedImageParam.grantRead(listImagesLambda);

    const vpc = ec2.Vpc.fromVpcAttributes(this, 'ECSVpc', {
      vpcId: ecsVpcId.valueAsString,
      availabilityZones: cdk.Fn.getAzs(),
      publicSubnetIds: [ecsSubnetA.valueAsString, ecsSubnetB.valueAsString]
      // publicSubnetIds: ecsSubnets.valueAsList
    })

    const cluster = ecs.Cluster.fromClusterAttributes(this, 'ECSCluster', {
      clusterName: ecsClusterName.valueAsString,
      vpc: vpc,
      securityGroups: []
    })


    // Get SSM parameter of credentials
    const srcCredentialsParam = ssm.StringParameter.fromStringParameterAttributes(this, 'SourceParameterCredentials', {
      // parameterName: credentialsParameterStore.valueAsString,
      parameterName: srcCredential.valueAsString,
      simpleName: true,
      type: ssm.ParameterType.SECURE_STRING,
      version: 1
    });

    const destCredentialsParam = ssm.StringParameter.fromStringParameterAttributes(this, 'DestinationParameterCredentials', {
      parameterName: destCredential.valueAsString,
      simpleName: true,
      type: ssm.ParameterType.SECURE_STRING,
      version: 1
    });

    srcCredentialsParam.grantRead(listImagesLambda)

    const taskDefinition = new ecs.TaskDefinition(this, 'ECRReplicationTask', {
      memoryMiB: '1024',
      cpu: '512',
      compatibility: ecs.Compatibility.FARGATE,
      family: `${cdk.Aws.STACK_NAME}-ECRReplicationTask`,
    });

    destCredentialsParam.grantRead(taskDefinition.taskRole)
    srcCredentialsParam.grantRead(taskDefinition.taskRole)

    const ecrRepositoryArn = 'arn:aws:ecr:us-west-2:627627941158:repository/drh-ecr-replication'
    const repo = ecr.Repository.fromRepositoryArn(this, 'ECRReplicationRepo', ecrRepositoryArn)

    const containerDefinition = taskDefinition.addContainer('ECRReplicationContainer', {
      image: ecs.ContainerImage.fromEcrRepository(repo),
      environment: {
        SOURCE_TYPE: sourceType.valueAsString,
        AWS_DEFAULT_REGION: this.region,
        AWS_ACCOUNT_ID: this.account,
        SRC_REGION: srcRegion.valueAsString,
        SRC_ACCOUNT_ID: srcAccountId.valueAsString,
        SRC_CREDENTIAL: srcCredential.valueAsString,
        DEST_REGION: destRegion.valueAsString,
        DEST_ACCOUNT_ID: destAccountId.valueAsString,
        DEST_PREFIX: destPrefix.valueAsString,
        DEST_CREDENTIAL: destCredential.valueAsString,

      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'DRH-ECR-replication' })
    });


    const ecrSrcReadOnlyPolicy = new iam.Policy(this, 'ECRSrcReadOnlyPolicy', {
      policyName: `${cdk.Aws.STACK_NAME}ECRSrcReadOnlyPolicy`,
      statements: [
        new iam.PolicyStatement({
          actions: [
            "ecr:GetAuthorizationToken",
          ],
          resources: [
            '*'
          ]
        }),
        new iam.PolicyStatement({
          actions: [
            "ecr:BatchCheckLayerAvailability",
            "ecr:GetDownloadUrlForLayer",
            "ecr:BatchGetImage",
          ],
          resources: [
            `arn:${cdk.Aws.PARTITION}:ecr:${srcRegion.valueAsString}:${cdk.Aws.ACCOUNT_ID}:repository/*`

          ]
        }),
      ]
    });

    const ecrSrcPolicy = ecrSrcReadOnlyPolicy.node.defaultChild as iam.CfnPolicy
    ecrSrcPolicy.cfnOptions.condition = isSrcInCurrentAccount

    ecrSrcReadOnlyPolicy.attachToRole(taskDefinition.taskRole);

    const ecrDestWritePolicy = new iam.Policy(this, 'ECRDestWritePolicy', {
      policyName: `${cdk.Aws.STACK_NAME}ECRDestWritePolicy`,
      statements: [
        new iam.PolicyStatement({
          actions: [
            "ecr:GetAuthorizationToken",
          ],
          resources: [
            '*'
          ]
        }),
        new iam.PolicyStatement({
          actions: [
            "ecr:CreateRepository",
            "ecr:CompleteLayerUpload",
            "ecr:UploadLayerPart",
            "ecr:InitiateLayerUpload",
            "ecr:PutImage",
            "ecr:BatchCheckLayerAvailability",
            "ecr:GetDownloadUrlForLayer",
            "ecr:BatchGetImage",
          ],
          resources: [
            `arn:${cdk.Aws.PARTITION}:ecr:${destRegion.valueAsString}:${cdk.Aws.ACCOUNT_ID}:repository/*`

          ]
        }),
      ]
    });

    const ecrDestPolicy = ecrDestWritePolicy.node.defaultChild as iam.CfnPolicy
    ecrDestPolicy.cfnOptions.condition = isDestInCurrentAccount
    ecrDestWritePolicy.attachToRole(taskDefinition.taskRole);


    const submitJob = new tasks.LambdaInvoke(this, 'Submit Lambda', {
      lambdaFunction: listImagesLambda,
      // Lambda's result is in the attribute `Payload`
      outputPath: '$.Payload'
    });

    const runTask = new tasks.EcsRunTask(this, 'Run Fargate Task', {
      integrationPattern: sfn.IntegrationPattern.RUN_JOB,
      cluster,
      taskDefinition,
      assignPublicIp: true,
      containerOverrides: [{
        containerDefinition,
        environment: [
          { name: 'IMAGE', value: sfn.JsonPath.stringAt('$.repositoryName') },
          { name: 'TAG', value: sfn.JsonPath.stringAt('$.imageTag') },
        ],
      }],
      launchTarget: new tasks.EcsFargateLaunchTarget(),
      resultPath: '$.result'
    });


    const putSuccessInDDBTask = new tasks.DynamoPutItem(this, 'Log Success in DynamoDB', {
      item: {
        Image: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.repositoryName')),
        Tag: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.imageTag')),
        Execution: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$$.Execution.Name')),
        // StartedTime: tasks.DynamoAttributeValue.fromNumber(sfn.JsonPath.numberAt('$.StartedAt')),
        // StoppedTime: tasks.DynamoAttributeValue.fromNumber(sfn.JsonPath.numberAt('$.StoppedAt')),
        Status: tasks.DynamoAttributeValue.fromString('Done'),
      },
      table: imageTable,
      returnValues: tasks.DynamoReturnValues.NONE,
      resultPath: '$.result'
    });

    const putFailureInDDBTask = new tasks.DynamoPutItem(this, 'Log Failure in DynamoDB', {
      item: {
        Image: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.repositoryName')),
        Tag: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.imageTag')),
        Execution: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$$.Execution.Name')),
        // StartedTime: tasks.DynamoAttributeValue.fromNumber(sfn.JsonPath.numberAt('$.StartedAt')),
        // StoppedTime: tasks.DynamoAttributeValue.fromNumber(sfn.JsonPath.numberAt('$.StoppedAt')),
        ErrorMessage: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.result.Error')),
        Status: tasks.DynamoAttributeValue.fromString('Error'),
      },
      table: imageTable,
      returnValues: tasks.DynamoReturnValues.NONE,
      resultPath: '$.result'
    });

    const topic = new sns.Topic(this, 'EcrReplicationTopic');
    topic.addSubscription(new subscriptions.EmailSubscription(alarmEmail.valueAsString));

    const snsTask = new tasks.SnsPublish(this, 'Publish To SNS', {
      topic,
      integrationPattern: sfn.IntegrationPattern.REQUEST_RESPONSE,
      message: sfn.TaskInput.fromObject({
        error: "Failed to copy image",
        execution: sfn.JsonPath.stringAt('$$.Execution.Name'),
        image: sfn.JsonPath.stringAt('$.repositoryName'),
        tag: sfn.JsonPath.stringAt('$.imageTag'),
      })
    });

    const endState = new sfn.Pass(this, 'EndState');

    const map = new sfn.Map(this, 'Map State', {
      maxConcurrency: 10,
      itemsPath: sfn.JsonPath.stringAt('$.Payload'),
    });

    const retryParam: sfn.RetryProps = {
      backoffRate: 2,
      interval: cdk.Duration.seconds(60),
      maxAttempts: 3,
    }

    map.iterator(runTask
      .addRetry(retryParam)
      .addCatch(putFailureInDDBTask.next(snsTask), { resultPath: '$.result' })
      .next(putSuccessInDDBTask));

    submitJob.next(map).next(endState)

    const ecrStateMachine = new sfn.StateMachine(this, 'ECRReplicationStateMachine', {
      stateMachineName: `${cdk.Aws.STACK_NAME}-ECRReplicationSM`,
      definition: submitJob
    });

    ecrStateMachine.node.addDependency(containerDefinition, taskDefinition, submitJob)

    const smRuleRole = new iam.Role(this, 'ECRReplicationSMExecRole', {
      assumedBy: new iam.ServicePrincipal('events.amazonaws.com'),
    })
    smRuleRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        "states:StartExecution",
      ],
      resources: [
        ecrStateMachine.stateMachineArn,
      ]
    }))

    const ecrStateMachineTarget = new SfnStateMachine(ecrStateMachine, { role: smRuleRole });
    const smRule = new Rule(this, 'ECRReplicationScheduleRule', {
      schedule: Schedule.rate(cdk.Duration.days(1)),
      targets: [ecrStateMachineTarget],
    });
    smRule.node.addDependency(ecrStateMachine, smRuleRole)


    const checkExecutionLambda = new lambda.Function(this, 'CheckExecutionFunction', {
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'step-func.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      memorySize: 256,
      timeout: cdk.Duration.minutes(15),
      // tracing: lambda.Tracing.ACTIVE,
      environment: {
        STATE_MACHINE_ARN: ecrStateMachine.stateMachineArn
      }
    });

    ecrStateMachine.grantStartExecution(checkExecutionLambda)
    ecrStateMachine.grantRead(checkExecutionLambda)

    //Run checkExecutionLambda on Create
    const lambdaTrigger = new cr.AwsCustomResource(this, 'StatefunctionTrigger', {
      policy: cr.AwsCustomResourcePolicy.fromStatements([new iam.PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        effect: iam.Effect.ALLOW,
        resources: [checkExecutionLambda.functionArn]
      })]),
      timeout: cdk.Duration.minutes(15),
      onCreate: {
        service: 'Lambda',
        action: 'invoke',
        parameters: {
          FunctionName: checkExecutionLambda.functionName,
          InvocationType: 'Event'
        },
        physicalResourceId: cr.PhysicalResourceId.of('JobSenderTriggerPhysicalId')
      },
      onUpdate: {
        service: 'Lambda',
        action: 'invoke',
        parameters: {
          FunctionName: checkExecutionLambda.functionName,
          InvocationType: 'Event'
        },
        physicalResourceId: cr.PhysicalResourceId.of('JobSenderTriggerPhysicalId')
      }
    })
    lambdaTrigger.node.addDependency(ecrStateMachine, smRule)
  }
}
