import unittest
from pathlib import Path
from ai_assistant.service import AssistantService
from ai_assistant.runtime_tasks import TaskError
from tests import test_runtime_sessions as fixtures

class NativePreferencesTests(unittest.TestCase):
    setUp=fixtures.NativeSessionTests.setUp
    def test_explicit_model_and_skill_choices_persist_without_executing_or_changing_permission(self):
        model=self.service.models.put(dict(name='Synthetic local',base_url='http://127.0.0.1:9/v1',api_key='synthetic-only',model='synthetic'))
        before=self.service.permission(self.cid)
        saved=self.service.set_native_conversation_preferences(self.cid,dict(revision=0,provider_model_id=model['id'],skill_ids=[]))
        self.assertEqual(saved['revision'],1);self.assertEqual(self.service.permission(self.cid),before)
        restarted=AssistantService(self.path,self.service.config)
        self.assertEqual(restarted.native_conversation_preferences(self.cid),saved)
        with self.assertRaises(TaskError):restarted.set_native_conversation_preferences(self.cid,dict(revision=0,provider_model_id=None,skill_ids=[]))
        with self.assertRaises(TaskError):restarted.set_native_conversation_preferences(self.cid,dict(revision=1,provider_model_id='missing',skill_ids=[]))
        with self.assertRaises(TaskError):restarted.set_native_conversation_preferences(self.cid,dict(revision=1,provider_model_id=None,skill_ids=['missing']))
        skill_ids=[restarted.skills.add('SKILL.md',f'---\nname: synthetic-{i}\ndescription: Synthetic test\n---\nSynthetic'.encode())['id'] for i in range(4)]
        accepted=restarted.set_native_conversation_preferences(self.cid,dict(revision=1,provider_model_id=model['id'],skill_ids=skill_ids[:3]))
        self.assertEqual(accepted['skill_ids'],skill_ids[:3])
        with self.assertRaises(TaskError):restarted.set_native_conversation_preferences(self.cid,dict(revision=2,provider_model_id=model['id'],skill_ids=skill_ids))
        restarted.organize_conversation(self.cid,{'archived':True})
        with self.assertRaises(TaskError):restarted.set_native_conversation_preferences(self.cid,dict(revision=2,provider_model_id=None,skill_ids=[]))
