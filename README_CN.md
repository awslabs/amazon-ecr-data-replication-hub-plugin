[English](./README.md)

# AWS Data Replication Hub - ECR 插件

## 目录
* [简介](#简介)
* [方案架构](#方案架构)
* [部署方式](#部署方式)
  * [准备工作](#准备工作)
  * [可用参数](#可用参数)
  * [通过AWS Cloudformation实施部署](#通过AWS-Cloudformation实施部署)
  * [通过AWS CDK实施部署](#通过AWS-CDK实施部署)
* [常问问题](#常问问题)

## 简介

[AWS Data Replication Hub](https://github.com/awslabs/aws-data-replication-hub) 是一种将数据从不同来源复制到AWS的解决方案。 该项目用于ECR复制插件。 每个复制插件都可以独立运行。 

以下是此插件的功能。

- [x] AWS账户或区域之间的Amazon ECR的复制
- [x] AWS Global区和AWS 中国区之间的Amazon ECR的复制
- [x] 公共Docker仓库到AWS ECR的复制
- [ ] 私有Docker仓库到AWS ECR的复制
- [x] 复制所有镜像，或仅复制选定的镜像
- [x] 支持一次性复制
- [x] 支持增量复制

该插件使用 [**skopeo**](https://github.com/containers/skopeo) 作为将镜像复制到Aamazon ECR的工具。 如果目标ECR中已经存在相同的层，则不会被再次复制。


## 方案架构

![ECR Plugin Architect](ecr-plugin-architect.png)


高概括的链路描述如下

1. EventBridge 规则用于触发Step Function以定期执行任务。 （默认情况下，每天触发）
1. 将调用Lambda以从源获取镜像列表
1. Lambda将列出源ECR中的所有存储库，或者从 AWS System Manager Parameter Store 中获取已存储的选定镜像列表
1. 复制任务将在Fargate中以最大10个并发运行。如果复制任务由于某种原因失败，它将自动重试3次
1. 每个任务都使用`skopeo复制`将图像复制到目标ECR中
1. 复制完成后，状态（成功或失败）将记录到DynamoDB中以进行跟踪


## 部署方式

有关此插件的部署的注意事项：

- 部署将自动在您的AWS账户中预配置lambda，dynamoDB表，ECS任务等资源
- 部署大约需要3-5分钟
- 部署完成后，数据复制任务将立即开始

###  准备工作

- 配置 **访问凭证**

如果源（或目标）不在当前的AWS账户中，则您需要提供`AccessKeyID`和`SecretAccessKey`（即`AK` / `SK`）以从Amazon ECR中拉取或推送镜像。 AWS Parameter Store 用于以安全方式存储访问凭证。

请在 **AWS Systems Manager** 的 **Parameter Store** 中创建一个参数，您可以使用默认名称`drh-credentials`（可选），选择 **SecureString**作为其类型，然后输入 **Value**，请遵循以下格式。

```
{
  "access_key_id": "<Your Access Key ID>",
  "secret_access_key": "<Your Access Key Secret>"
}
```

> 注意：如果源类型为“公共（Public）”，则无需提供源的访问凭证。

- 设置 **ECS Cluster** 和 **VPC**

此插件的部署将在您的AWS账户的Fargate中启动运行的ECS任务，因此如果您还没有部署ECS集群和VPC，则需要在部署之前对其进行设置。

> 注意：对于ECS群集，可以选择 **仅限联网（Networking only）** 类型。 对于VPC，请确保VPC在两个可用区域中至少应具有两个子网。

### 可用参数

以下是所有可用的部署参数：

| 参数 | 默认值  | 参数描述   |
|---------------------------|------------------|------------------------------------------------------|
| sourceType| Amazon_ECR   | 选择源容器仓库的类型，例如Amazon_ECR或来自Docker Hub，gco.io等的Public 仓库。 |
| srcRegion | '' | 源 AWS 区域（Region） (仅在源类型为Amazon ECR时才需要).   |
| srcAccountId  | ''   | 源 AWS 账户 ID (仅在源类型为Amazon ECR时才需要), 如果来源在当前帐户中，则将其留空。   |
| srcList   | ALL  | 源图像列表的类型。 ALL 或 SELECTED |
| srcImageList  | ''   | 以逗号分隔的源镜像列表, 例如 ubuntu:latest,alpine:latest... 如果 srcList 为 ALL, 则此参数会被忽略.|
| srcCredential | ''   | AWS System Managers 中的参数，用来获取从源端拉取镜像的访问凭证. |
| destRegion| ''   | 目标AWS区域. |
| destAccountId | ''   | 目标AWS账户ID，如果目标账户为当前账户，则将其留空。 |
| destPrefix| ''   | 目标前缀（请保留为空白，暂时不需要）|
| destCredential| ''  | AWS System Managers 中的参数，用来获取向目标端推送镜像的访问凭证. |
| ecsClusterName| <requires input> | 用于运行 ECS task 的 ECS Cluster 名称 |
| ecsVpcId  | <requires input> | 用于运行 ECS task 的 VPC ID, 例如 vpc-bef13dc7 |
| ecsSubnetA| <requires input> | 用于运行 ECS task 的 Subnet IDs. 请提供两个子网ID以实现高可用性。  |
| ecsSubnetB| <requires input> | 用于运行 ECS task 的 Subnet IDs. 请提供两个子网ID以实现高可用性。  |
| alarmEmail| ''   | 告警电子邮件通知地址，以在发生任何故障时接收通知。   |


### 通过AWS-Cloudformation实施部署

请按照以下步骤通过AWS Cloudformation部署此插件。

1. 登录到AWS管理控制台，切换到将CloudFormation Stack部署到的目标区域。

1. 单击以下按钮以在该区域中启动CloudFormation堆栈。

    - 对于Global区

    [![Launch Stack](launch-stack.svg)](https://console.aws.amazon.com/cloudformation/home#/stacks/create/template?stackName=DataReplicationECRStack&templateURL=https://aws-gcr-solutions.s3.amazonaws.com/Aws-data-replication-component-ecr/latest/AwsDataReplicationComponentEcrStack.template)

    - 对于中国区

    [![Launch Stack](launch-stack.svg)](https://console.amazonaws.cn/cloudformation/home#/stacks/create/template?stackName=DataReplicationECRStack&templateURL=https://aws-gcr-solutions.s3.cn-north-1.amazonaws.com.cn/Aws-data-replication-component-ecr/latest/AwsDataReplicationComponentEcrStack.template)
    
1. 点击 **Next**. 相应地为参数指定值。如果需要，请更改堆栈名称。

1. 点击 **Next**. 配置其他堆栈选项，例如标签（可选）。

1. 点击 **Next**. 审阅并最终确认，然后单击 **创建堆栈** 以开始部署。

如果您要对此插件进行自定义更改，则可以遵循[自定义版本](CUSTOM_BUILD.md)指南。

> 注意：如果您不再需要复制任务，则只需在CloudFormation控制台删除堆栈即可。

### 通过AWS-CDK实施部署

如果您要使用AWS CDK部署此插件，请确保满足以下先决条件：

* [AWS Command Line Interface](https://aws.amazon.com/cli/)
* Node.js 12.x or later

在项目 **source** 文件夹下，运行以下命令将TypeScript编译为JavaScript。

```
cd source
npm install -g aws-cdk
npm install && npm run build
```

然后您可以运行 `cdk deploy` 命令来部署此插件。请相应地指定参数值，例如：

```
cdk deploy \
--parameters sourceType=Amazon_ECR \
--parameters srcRegion=eu-west-1 \
--parameters destAccountId=123456789012 \
--parameters destCredential=drh-credentials \
--parameters destRegion=cn-northwest-1 \
--parameters ecsClusterName=testcluster \
--parameters ecsVpcId=vpc-123456 \
--parameters ecsSubnetA=subnet-1234567 \
--parameters ecsSubnetB=subnet-1234568
```

> 注意：如果不再需要复制任务，则可以运行`cdk destroy`。 此命令将从您的AWS账户中删除此插件创建的堆栈。

## 常问问题

更新中.