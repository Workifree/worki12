
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
        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        const authHeader = req.headers.get('Authorization')
        if (!authHeader) throw new Error('Missing Authorization header')
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''))
        if (userError || !user) throw new Error('Invalid Token')

        // Parse body
        const { action, payload } = await req.json()

        // 1. UPDATE PROFILE
        if (action === 'update_profile') {
            const {
                firstName, lastName, // User
                description, videoUrl, // Freelancer
                companyName, city, state, address // Client
            } = payload

            // Update User
            if (firstName || lastName) {
                await supabaseAdmin.from('User').update({ firstName, lastName }).eq('id', user.id)
            }

            // Update ClientProfile
            if (companyName || city || state || address) {
                await supabaseAdmin.from('ClientProfile').update({
                    companyName, city, state, address
                }).eq('userId', user.id)
            }

            // Update FreelancerProfile
            if (description || videoUrl !== undefined) {
                await supabaseAdmin.from('FreelancerProfile').update({
                    description,
                    videoUrl
                }).eq('userId', user.id)
            }

            return new Response(JSON.stringify({ message: 'Profile updated' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 })
        }

        // 2. SKILLS
        if (action === 'add_skill') {
            const { skillName } = payload
            if (!skillName) throw new Error('Missing skillName')

            const { data: fp } = await supabaseAdmin.from('FreelancerProfile').select('id').eq('userId', user.id).single()
            if (!fp) throw new Error('Freelancer Profile not found')

            let { data: skill } = await supabaseAdmin.from('Skill').select('id').eq('name', skillName).single()
            if (!skill) {
                const { data: newSkill } = await supabaseAdmin.from('Skill').insert({ name: skillName }).select('id').single()
                skill = newSkill
            }

            const { data: linked } = await supabaseAdmin.from('_FreelancerProfileToSkill').select('A').eq('A', fp.id).eq('B', skill.id).single()
            if (!linked) {
                await supabaseAdmin.from('_FreelancerProfileToSkill').insert({ A: fp.id, B: skill.id })
            }

            return new Response(JSON.stringify({ message: 'Skill added' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 })
        }

        if (action === 'remove_skill') {
            const { skillName } = payload
            const { data: fp } = await supabaseAdmin.from('FreelancerProfile').select('id').eq('userId', user.id).single()
            if (!fp) throw new Error('Freelancer Profile not found')

            const { data: skill } = await supabaseAdmin.from('Skill').select('id').eq('name', skillName).single()
            if (skill) {
                await supabaseAdmin.from('_FreelancerProfileToSkill').delete().eq('A', fp.id).eq('B', skill.id)
            }
            return new Response(JSON.stringify({ message: 'Skill removed' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 })
        }

        // 3. EXPERIENCE
        if (action === 'add_experience') {
            const experienceData = payload
            const { data: fp } = await supabaseAdmin.from('FreelancerProfile').select('id').eq('userId', user.id).single()
            if (!fp) throw new Error('Freelancer Profile not found')

            const { data: exp, error } = await supabaseAdmin.from('WorkExperience').insert({
                ...experienceData,
                freelancerProfileId: fp.id
            }).select().single()

            if (error) throw error
            return new Response(JSON.stringify(exp), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 201 })
        }

        if (action === 'update_experience') {
            const { id, ...updates } = payload
            const { data: fp } = await supabaseAdmin.from('FreelancerProfile').select('id').eq('userId', user.id).single()
            // Enforce ownership
            const { error } = await supabaseAdmin.from('WorkExperience').update(updates).eq('id', id).eq('freelancerProfileId', fp.id)
            if (error) throw error
            return new Response(JSON.stringify({ message: 'Updated' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 })
        }

        if (action === 'delete_experience') {
            const { id } = payload
            const { data: fp } = await supabaseAdmin.from('FreelancerProfile').select('id').eq('userId', user.id).single()
            const { error } = await supabaseAdmin.from('WorkExperience').delete().eq('id', id).eq('freelancerProfileId', fp.id)
            if (error) throw error
            return new Response(JSON.stringify({ message: 'Deleted' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 })
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
