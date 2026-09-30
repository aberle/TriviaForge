# Lets you reach the instance with `aws ssm start-session` instead of opening port 22 / managing an
# SSH key. The instance already has an outbound path to the SSM endpoints via the default VPC's
# internet gateway (no VPC endpoints needed for a single low-traffic box).
resource "aws_iam_role" "ec2" {
  name = "triviaforge-ec2-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ec2" {
  name = "triviaforge-ec2-profile"
  role = aws_iam_role.ec2.name
}
