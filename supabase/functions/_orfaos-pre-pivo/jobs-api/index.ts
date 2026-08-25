
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        // Admin client to bypass RLS for complex transactions/relations
        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        // User client to verify auth (optional, or just use admin to verify token)
        const authHeader = req.headers.get('Authorization')
        if (!authHeader) throw new Error('Missing Authorization header')

        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''))
        if (userError || !user) throw new Error('Invalid Token')

        // Parse body
        const { action, payload } = await req.json()

        // 1. CREATE JOB
        if (action === 'create') {
            const { title, description, budget, requiredSkills } = payload

            // Check if user is a client
            const { data: clientProfile, error: profileError } = await supabaseAdmin
                .from('ClientProfile')
                .select('id, companyName')
                .eq('userId', user.id)
                .single()

            if (profileError || !clientProfile) {
                throw new Error('Access denied: Only clients can create jobs.') // Or 403
            }

            // Create Job
            const { data: job, error: jobError } = await supabaseAdmin
                .from('Job')
                .insert({
                    title,
                    description,
                    budget,
                    authorId: clientProfile.id
                })
                .select()
                .single()

            if (jobError) throw new Error('Failed to create job: ' + jobError.message)

            // Handle Skills (Connect or Create)
            if (requiredSkills && requiredSkills.length > 0) {
                const skillIds = []
                for (const skillName of requiredSkills) {
                    // Check exist
                    let { data: skill } = await supabaseAdmin.from('Skill').select('id').eq('name', skillName).single()

                    if (!skill) {
                        // Create
                        const { data: newSkill, error: createError } = await supabaseAdmin.from('Skill').insert({ name: skillName }).select('id').single()
                        if (createError) {
                            // Concurrency handle: retry fetch if exists now
                            const { data: exists } = await supabaseAdmin.from('Skill').select('id').eq('name', skillName).single()
                            if (exists) skill = exists
                        } else {
                            skill = newSkill
                        }
                    }
                    if (skill) skillIds.push(skill.id)
                }

                // Insert into _JobToSkill
                // Prisma implicit many-to-many uses table `_JobToSkill` with columns `A` (JobId) and `B` (SkillId) usually
                // But direct access to `_` tables via API might be blocked.
                // If blocked, we rely on the user manually mapping this or using a explicit relation structure.
                // For now, let's try inserting to `_JobToSkill` if exposed, or we assume we might need to change schema to explicit relation later 
                // if this fails.
                if (skillIds.length > 0) {
                    const pivots = skillIds.map(skId => ({
                        A: job.id,
                        B: skId
                    }))
                    // Attempt to insert. If this fails due to permissions/visibility, we'll need a different strategy.
                    // NOTE: _JobToSkill might not be exposed to PostgREST API.
                    try {
                        const { error: pivotError } = await supabaseAdmin.from('_JobToSkill').insert(pivots)
                        if (pivotError) console.error('Failed to link skills (check table visibility):', pivotError)
                    } catch (e) {
                        console.error('Pivot insert failed', e)
                    }
                }
            }

            // Notify Client (Confirmation)
            const message = `Sua vaga "${job.title}" foi criada com sucesso.`
            // We use the same 'realtimeService' logic but implemented here via Supabase
            await supabaseAdmin.channel(`user:${user.id}`).send({
                type: 'broadcast',
                event: 'new_notification',
                payload: { message: message, link: '/my-jobs' }
            })

            return new Response(JSON.stringify(job), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 201 })
        }

        // 2. APPLY TO JOB
        if (action === 'apply') {
            const { jobId } = payload
            const applicantId = user.id

            // Check if already applied
            const { data: existing } = await supabaseAdmin
                .from('JobApplication')
                .select('id')
                .eq('jobId', jobId)
                .eq('applicantId', applicantId)
                .single()

            if (existing) throw new Error('Você já se candidatou para esta vaga.')

            // Create Application
            const { data: application, error: appError } = await supabaseAdmin
                .from('JobApplication')
                .insert({ jobId, applicantId })
                .select()
                .single()

            if (appError) throw new Error('Failed to apply: ' + appError.message)

            // Notify Job Author
            const { data: jobWithAuthor } = await supabaseAdmin
                .from('Job')
                .select('title, author:ClientProfile(userId)')
                .eq('id', jobId)
                .single()

            if (jobWithAuthor && jobWithAuthor.author && jobWithAuthor.author.userId) {
                const msg = `Nova candidatura recebida na vaga "${jobWithAuthor.title}".`
                await supabaseAdmin.channel(`user:${jobWithAuthor.author.userId}`).send({
                    type: 'broadcast',
                    event: 'new_notification',
                    payload: { message: msg, link: '/my-jobs' }
                })
            }

            return new Response(JSON.stringify({ message: 'Candidatura enviada!', application }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 201 })
        }

        throw new Error('Action not found')

    } catch (error) {
        console.error(error)
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
        })
    }
})
