export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getDeploymentTruth } from '@/lib/build-identity';

export async function GET() {
  const truth = getDeploymentTruth();
  return NextResponse.json(truth, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'X-Sohee-Build': truth.buildSha,
      'X-Sohee-Worker-Version': truth.workerVersion,
    },
  });
}
