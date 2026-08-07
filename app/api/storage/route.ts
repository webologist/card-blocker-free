import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getSupabaseClient() {
  return createClient(supabaseUrl, supabaseKey);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (!key) {
      // List all keys
      const sb = getSupabaseClient();
      const { data } = await sb.from('kv_store').select('key');
      return NextResponse.json({ keys: (data || []).map((r: any) => r.key) });
    }

    // Get specific key
    const sb = getSupabaseClient();
    const { data } = await sb.from('kv_store').select('value').eq('key', key).single();

    if (!data) {
      return NextResponse.json({ value: null });
    }

    try {
      return NextResponse.json({
        key,
        value: JSON.parse(data.value),
      });
    } catch {
      return NextResponse.json({ key, value: data.value });
    }
  } catch (error) {
    console.error('[Storage GET] Error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { key, value } = body;

    if (!key) {
      return NextResponse.json({ error: 'key required' }, { status: 400 });
    }

    const sb = getSupabaseClient();
    const { error } = await sb
      .from('kv_store')
      .upsert({
        key,
        value: typeof value === 'string' ? value : JSON.stringify(value),
      }, { onConflict: 'key' });

    if (error) {
      console.error('[Storage POST] Error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ key, value });
  } catch (error) {
    console.error('[Storage POST] Handler error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (!key) {
      return NextResponse.json({ error: 'key required' }, { status: 400 });
    }

    const sb = getSupabaseClient();
    await sb.from('kv_store').delete().eq('key', key);

    return NextResponse.json({ key, deleted: true });
  } catch (error) {
    console.error('[Storage DELETE] Error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}
