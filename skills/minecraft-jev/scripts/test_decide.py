import unittest
from unittest.mock import patch
import httpx
from decide import choose

class DecisionBoundary(unittest.TestCase):
    candidates={'act':'Known action','fallback':'Return to parent'}
    def run_response(self,status=200,answer=None):
        if answer is None: answer={'choice':'act','confidence':0.99,'probabilities':{'act':0.99,'fallback':0.01}}
        def handler(request):
            self.assertEqual(str(request.url),'https://api.typesafe.ai/v1/systemone')
            self.assertEqual(request.headers['Authorization'],'Bearer test-only')
            return httpx.Response(status,json={'model':'jev-1.13.0','answers':{'next':answer}})
        with patch('decide.api_key',return_value='test-only'), httpx.Client(transport=httpx.MockTransport(handler),follow_redirects=False) as c:
            return choose(c,'sanitized observation','Select next',self.candidates)
    def test_accepted_choice(self):
        self.assertEqual(self.run_response()['choice'],'act')
    def test_uncertain_choice_returns_parent(self):
        r=self.run_response(answer={'choice':'act','confidence':0.89,'probabilities':{'act':0.94,'fallback':0.06}})
        self.assertEqual(r['choice'],'fallback');self.assertEqual(r['raw_choice'],'act')
    def test_errors_and_redirects_return_parent(self):
        for status in [302,401,422,429,529]:
            with self.subTest(status=status):self.assertEqual(self.run_response(status)['choice'],'fallback')
    def test_arbitrary_choice_rejected(self):
        with self.assertRaises(ValueError):self.run_response(answer={'choice':'shell','confidence':1,'probabilities':{'act':1,'fallback':0}})
    def test_invalid_probability_rejected(self):
        with self.assertRaises(ValueError):self.run_response(answer={'choice':'act','confidence':1,'probabilities':{'act':float('nan'),'fallback':0}})
    def test_missing_fallback_rejected_before_request(self):
        with httpx.Client() as client, self.assertRaises(ValueError):choose(client,'x','x',{'one':'x','two':'y'})

if __name__=='__main__':unittest.main()
